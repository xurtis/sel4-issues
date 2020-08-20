// Functional utilities
const pipe = fns => {
	var fn = x => x;
	fns.forEach(f => {
		const old_fn = fn;
		fn = (x) => f(old_fn(x));
	});
	return fn;
}
Array.prototype.pipeMap = function (fns) {
	return this.map(pipe(fns));
}

// HTML module builder
const Html = () => {
	// Function for creating a HTML node
	const node = name => (children, attributes = {}) => {
		var element = document.createElement(name);
		for (attribute in attributes) {
			element.setAttribute(attribute, attributes[attribute]);
		}
		if (children instanceof Array) {
			children.forEach(child => {
				if (typeof child === "string") {
					element.appendChild(document.createTextNode(child));
				} else {
					element.appendChild(child);
				}
			})
		} else if (typeof children === "string") {
			element.appendChild(document.createTextNode(children));
		} else {
			element.appendChild(children);
		}
		return element;
	};

	// Variable that will refer to the completed object
	var h;

	// Base properties of the object
	const base = {
		"text": text => document.createTextNode(text.toString()),
		"simple_table": (columns, rows) => h.table([
			h.thead(h.tr(columns.map(h.th))),
			h.tbody(rows.map(h.tr)),
		]),
		"simple_link": (inner, href, class_name = undefined) => h.a(
			inner,
			{
				"class": class_name,
				"href": href,
				"target": "_blank",
			},
		)
	};

	// Shim to generate HTML nodes when they don't overlap with a
	// pre-defined property.
	const handler = {
		"get": (target, prop, receiver) => {
			if (target.hasOwnProperty(prop)) {
				return target[prop];
			} else {
				return node(prop);
			}
		}
	};
	h = new Proxy(base, handler);

	return h;
}
const h = Html();

const gh_user = user => h.div(
	[
		h.img([], { "src": user.avatar_url, "alt": user.login }),
		h.simple_link(user.login, user.html_url, "gh-user-link")
	],
	{ "class": "gh-user" },
);

const gh_user_list = users => h.ul(
	users.pipeMap([gh_user, h.li]),
	{ "class": "gh-user-list" },
);

// Github query module
const GitHub = () => {
	var update_hook = async () => {};

	const query = async (url, context = {}, params = {}) => {
		var req_headers = new Headers();
		req_headers.append(
			"Accept",
			"application/vnd.github.v3+json",
		);

		const split = url.lastIndexOf("{");
		if (split > 0) {
			const var_name = url.slice(split + 2, url.length - 1);
			url = url.slice(0, split);

			if (context.hasOwnProperty(var_name)) {
				url = url + "/" + context[var_name].toString();
			}
		}

		const req_url = new URL(url);
		req_url.search = new URLSearchParams(params);
		const request = new Request(
			req_url,
			{ "headers": req_headers },
		);
		const response = await fetch(request);

		if (url.search(/rate_limit/) === -1) {
			/// Notify the app of the request
			await update_hook();
		}

		return response.json();
	};

	const base_query = (path, params = {}) => {
		return query(`https://api.github.com${path}`, {}, params);
	}

	const rate_limit = () => base_query(`/rate_limit`);
	const rate_reset = async () => {
		const limit = await rate_limit();
		return new Date(limit.resources.core.reset * 1000);
	}

	const org_repos = async org => {
		const repos = await base_query(
			`/orgs/${org}/repos`,
			{ "sort": "full_name", "per_page": 100 },
		);
		return repos.filter(repo => !(repo.archived || repo.disabled));
	}

	return {
		"query": query,
		"base_query": base_query,
		"user": () => base_query("/user"),
		"rate_limit": rate_limit,
		"rate_reset": rate_reset,
		"org_repos": org_repos,
		"pulls": repo => query(repo.pulls_url, {}, {"state": "open"}),
		"issues": async repo => {
			const issues = await query(
				repo.issues_url,
				{},
				{"state": "open"},
			);
			return issues.filter(
				issue => !issue.hasOwnProperty("pull_request"),
			);
		},
		"set_hook": hook => {
			update_hook = hook;
		},
	}
}
const gh = GitHub();

/// Create an initial repo block
const repo_block = repo => {
	var info = h.div([], { "class": "info" });
	var header = h.h2(repo.full_name);
	var block = h.div([
		header,
		info,
	], { "class": "repo" });

	/// Reload the block from github
	const reloadBlock = async () => {
		// Generate table of pull requeusts
		const pulls = h.simple_table(
			["Number", "Name", "Author", "Reviewer(s)", "Assignee(s)"],
			(await gh.pulls(repo)).flatMap(pull => [
				[
					h.simple_link(`#${pull.number}`, pull.html_url),
					h.simple_link(pull.title, pull.html_url),
					gh_user(pull.user),
					gh_user_list(pull.requested_reviewers),
					gh_user_list(pull.assignees),
				].map(h.td),
				[
					h.td(
						[h.pre(pull.body)],
						{ "colspan": 5, "class": "note" },
					),
				],
			]),
		);

		// Generate tbale of issues
		const issues = h.simple_table(
			["Number", "Name", "Author", "Assignee(s)"],
			(await gh.issues(repo)).flatMap(issue => [
				[
					h.simple_link(`#${issue.number}`, issue.html_url),
					h.simple_link(issue.title, issue.html_url),
					gh_user(issue.user),
					gh_user_list(issue.assignees),
				].map(h.td),
				[
					h.td(
						[h.pre(issue.body)],
						{ "colspan": 4, "class": "note" },
					),
				],
			]),
		);

		// Update the info block
		block.removeChild(info);
		info = h.div([
			h.h3("Pull Requests"),
			pulls,
			h.h3("Issues"),
			issues,
		], { "class": "info" });
		block.appendChild(info);

		// Schedule another update for an hour from now
		setTimeout(60 * 60 * 1000, reloadBlock);
	};
	header.addEventListener("click", reloadBlock);

	return block;
}

/// Load the initial page
const main = async () => {
	const repos = [
		await gh.org_repos("seL4"),
		await gh.org_repos("seL4proj"),
	];

	var remaining = h.kbd("??");
	var reset = h.kbd("??");
	const check_limit = async () => {
		const limit = await gh.rate_limit();
		remaining.removeChild(remaining.firstChild);
		remaining.appendChild(h.text(limit.resources.core.remaining));
		reset.removeChild(reset.firstChild);
		reset.appendChild(h.text(
			new Date(limit.resources.core.reset * 1000),
		));
	}

	await check_limit();
	gh.set_hook(check_limit);

	const doc = h.div([
		h.h1("GitHub PRs and Issues"),
		h.p([
			h.text("You have "),
			remaining,
			h.text(" requests remaining which will reset at "),
			reset,
			h.text("."),
		]),
		h.div(
			repos.flat().map(repo_block),
			{ "class": "repos" },
		),
	], {"id": "content"})

	document.body = h.body([doc]);
}

// Execute main after the DOM is loaded
document.addEventListener('DOMContentLoaded', main);
