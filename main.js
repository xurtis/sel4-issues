const unit = x => [x];
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
	const node_names = [
		"a", "body", "code", "div", "h1", "h2", "h3", "h4", "kbd", "p",
		"pre", "table", "thead", "tbody", "tfoot", "th", "td", "tr",
		"img", "span", "ul", "li",
	];

	// Function for creating a node
	const node = name => (children, attributes = {}) => {
		var element = document.createElement(name);
		for (attribute in attributes) {
			element.setAttribute(attribute, attributes[attribute]);
		}
		children.forEach(child => {
			element.appendChild(child);
		})
		return element;
	};

	var h = {
		"text": text => document.createTextNode(text.toString()),
		"simple_table": (columns, rows) => h.table([
			h.thead([h.tr(columns.pipeMap([h.text, unit, h.th]))]),
			h.tbody(rows.map(h.tr)),
		]),
		"simple_link": (inner, href, class_name = undefined) => h.a(
			[h.text(inner)],
			{
				"class": class_name,
				"href": href,
				"target": "_blank",
			},
		)
	};

	node_names.forEach(name => {
		h[name] = node(name);
	})

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
	users.pipeMap([gh_user, unit, h.li]),
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
	var header = h.h2([h.text(repo.full_name)]);
	var block = h.div([
		header,
		info,
	], { "class": "repo" });

	/// Reload the block from github
	const reloadBlock = async () => {
		block.removeChild(info);

		const pull_heading = [
			"Number", "Name", "Author", "Reviewer(s)", "Assignee(s)",
		];
		const pull_table = (await gh.pulls(repo)).flatMap(pull => [
			[
				h.simple_link(`#${pull.number}`, pull.html_url),
				h.simple_link(pull.title, pull.html_url),
				gh_user(pull.user),
				gh_user_list(pull.requested_reviewers),
				gh_user_list(pull.assignees),
			].pipeMap([unit, h.td]),
			[
				h.td(
					[h.pre([h.text(pull.body)])],
					{ "colspan": 5, "class": "note" },
				),
			],
		]);

		const issue_heading = [
			"Number", "Name", "Author", "Assignee(s)",
		];
		const issue_table = (await gh.issues(repo)).flatMap(issue => [
			[
				h.simple_link(`#${issue.number}`, issue.html_url),
				h.simple_link(issue.title, issue.html_url),
				gh_user(issue.user),
				gh_user_list(issue.assignees),
			].pipeMap([unit, h.td]),
			[
				h.td(
					[h.pre([h.text(issue.body)])],
					{ "colspan": 4, "class": "note" },
				),
			],
		]);

		info = h.div([
			h.h3([h.text("Pull Requests")]),
			h.simple_table(pull_heading, pull_table),
			h.h3([h.text("Issues")]),
			h.simple_table(issue_heading, issue_table),
		], { "class": "info" });
		block.appendChild(info);

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

	var remaining = h.kbd([h.text("??")]);
	var reset = h.kbd([h.text("??")]);
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
		h.h1([h.text("GitHub PRs and Issues")]),
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
