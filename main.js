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

	var nodes = {
		"text": text => document.createTextNode(text.toString()),
	};

	node_names.forEach(name => {
		nodes[name] = node(name);
	})

	return nodes;
}
const h = Html();

const table = (columns, rows) => {
	var header = [];
	columns.forEach(title => {
		header.push(h.th([h.text(title)]));
	});

	var body = [];
	rows.forEach(row => {
		body.push(h.tr(row));
	});

	return h.table([
		h.thead([h.tr(header)]),
		h.tbody(body),
	]);
}

const gh_user = user => h.div(
	[
		h.img([], { "src": user.avatar_url, "alt": user.login }),
		h.a(
			[h.text(user.login)],
			{
				"class": "gh-user-link",
				"href": user.html_url,
				"target": "_blank",
			},
		),
	],
	{ "class": "gh-user" },
);

const gh_user_list = users => {
	var ul = [];
	users.forEach(user => {
		ul.push(h.li([gh_user(user)]));
	});

	return h.ul(
		ul,
		{ "class": "gh-user-list" },
	);
};

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
				console.log("woot");
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

/// Set the body of the HTML document
const setBody = body => {
	document.body = h.body([body]);
}

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

		const pulls = await gh.pulls(repo);
		var pull_table = [];
		pulls.forEach(pull => {
			pull_table.push([
				h.td([h.a(
					[h.text(`#${pull.number}`)],
					{ "href": pull.html_url, "target": "_blank" },
				)]),
				h.td([h.a(
					[h.text(pull.title)],
					{ "href": pull.html_url, "target": "_blank" },
				)]),
				// h.td([h.kbd([h.text(pull.base.label)])]),
				// h.td([h.kbd([h.text(pull.head.label)])]),
				h.td([gh_user(pull.user)]),
				h.td([gh_user_list(pull.requested_reviewers)]),
				h.td([gh_user_list(pull.assignees)]),
			]);
			pull_table.push([
				h.td([
					h.pre([h.text(pull.body)]),
				], { "colspan": 5, "class": "note" }),
			]);
		})

		const issues = await gh.issues(repo);
		var issue_table = [];
		issues.forEach(issue => {
			issue_table.push([
				h.td([h.a(
					[h.text(`#${issue.number}`)],
					{ "href": issue.html_url, "target": "_blank" },
				)]),
				h.td([h.a(
					[h.text(issue.title)],
					{ "href": issue.html_url, "target": "_blank" },
				)]),
				h.td([gh_user(issue.user)]),
				h.td([gh_user_list(issue.assignees)]),
			]);
			issue_table.push([
				h.td([
					h.pre([h.text(issue.body)]),
				], { "colspan": 4, "class": "note" }),
			]);
		})

		info = h.div([
			h.h3([h.text("Pull Requests")]),
			table(
				["Number", "Name", /* "Base", "Head" */, "Author", "Reviewer(s)", "Assignee(s)" ],
				// Title and body use a full row
				pull_table,
			),
			h.h3([h.text("Issues")]),
			table(
				["Number", "Name", "Author", "Assignee(s)" ],
				// Title and body use a full row
				issue_table,
			),
		], { "class": "info" });
		block.appendChild(info);

		setTimeout(60 * 60 * 1000, reloadBlock);
	};
	header.addEventListener("click", reloadBlock);

	return block;
}

/// Load the initial page
const main = async () => {
	const gh_repos = [
		await gh.org_repos("seL4"),
		await gh.org_repos("seL4proj"),
	].flat();

	var repos = []
	gh_repos.forEach(repo => {
		repos.push(repo_block(repo));
	});

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
		h.div(repos, { "class": "repos" }),
	], {"id": "content"})

	setBody(doc);
}

// Execute main after the DOM is loaded
document.addEventListener('DOMContentLoaded', main);
