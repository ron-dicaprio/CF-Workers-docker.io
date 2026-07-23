// _worker.js

// Docker镜像仓库主机地址
let hub_host = 'registry-1.docker.io';
// Docker认证服务器地址
const auth_url = 'https://auth.docker.io';

let 屏蔽爬虫UA = ['netcraft'];

// 根据主机名选择对应的上游地址
function routeByHosts(host) {
	const routes = {
		"quay": "quay.io",
		"gcr": "gcr.io",
		"k8s-gcr": "k8s.gcr.io",
		"k8s": "registry.k8s.io",
		"ghcr": "ghcr.io",
		"cloudsmith": "docker.cloudsmith.io",
		"nvcr": "nvcr.io",
		"test": "registry-1.docker.io",
	};
	if (host in routes) return [routes[host], false];
	else return [hub_host, true];
}

const PREFLIGHT_INIT = {
	headers: new Headers({
		'access-control-allow-origin': '*',
		'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
		'access-control-max-age': '1728000',
	}),
};

function makeRes(body, status = 200, headers = {}) {
	headers['access-control-allow-origin'] = '*';
	return new Response(body, { status, headers });
}

function newUrl(urlStr, base) {
	try {
		return new URL(urlStr, base);
	} catch (err) {
		console.error(err);
		return null;
	}
}

async function nginx() {
	return `<!DOCTYPE html>
<html>
<head><title>Welcome to nginx!</title><style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif;}</style></head>
<body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p></body></html>`;
}

export default {
	async fetch(request, env, ctx) {
		const getReqHeader = (key) => request.headers.get(key);

		let url = new URL(request.url);
		const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
		if (env.UA) 屏蔽爬虫UA = 屏蔽爬虫UA.concat(await ADD(env.UA));
		const workers_url = `https://${url.hostname}`;

		// 上游路由
		const ns = url.searchParams.get('ns');
		const hostname = url.searchParams.get('hubhost') || url.hostname;
		const hostTop = hostname.split('.')[0];

		let checkHost;
		if (ns) {
			hub_host = ns === 'docker.io' ? 'registry-1.docker.io' : ns;
		} else {
			checkHost = routeByHosts(hostTop);
			hub_host = checkHost[0];
		}
		const fakePage = checkHost ? checkHost[1] : false;
		console.log(`hostTop: ${hostTop}, hub_host: ${hub_host}`);

		// 屏蔽爬虫 UA
		if (屏蔽爬虫UA.some(fxxk => userAgent.includes(fxxk)) && 屏蔽爬虫UA.length > 0) {
			return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
		}

		// 只允许 Registry API
		if (!url.pathname.startsWith('/v2/') && !url.pathname.startsWith('/token')) {
			return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
		}

		url.hostname = hub_host;
		const isDockerHub = hub_host === 'registry-1.docker.io' || hub_host === 'index.docker.io';
		const dockerHubToken = env.DOCKER_HUB_TOKEN || null;
		const dockerHubUsername = env.DOCKER_HUB_USERNAME || null;

		// 构造用于 auth.docker.io 的 Basic Auth 头（仅当用户配置了用户名和令牌）
		const basicAuth = (isDockerHub && dockerHubUsername && dockerHubToken)
			? 'Basic ' + btoa(`${dockerHubUsername}:${dockerHubToken}`)
			: null;

		// 处理 %3A -> library/
		if (!/%2F/.test(url.search) && /%3A/.test(url.toString())) {
			url = new URL(url.toString().replace(/%3A(?=.*?&)/, '%3Alibrary%2F'));
			console.log(`handle_url: ${url}`);
		}

		// ---------- 处理 /token 请求 ----------
		if (url.pathname.includes('/token')) {
			const headers = {
				'Host': 'auth.docker.io',
				'User-Agent': getReqHeader("User-Agent"),
				'Accept': getReqHeader("Accept"),
				'Accept-Language': getReqHeader("Accept-Language"),
				'Accept-Encoding': getReqHeader("Accept-Encoding"),
				'Connection': 'keep-alive',
				'Cache-Control': 'max-age=0'
			};
			// 如果配置了认证，附加 Basic Auth
			if (basicAuth) {
				headers['Authorization'] = basicAuth;
			}
			const token_url = auth_url + url.pathname + url.search;
			return fetch(new Request(token_url, request), { headers });
		}

		// 自动补全 library/ 路径
		if (hub_host === 'registry-1.docker.io' && /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) && !/^\/v2\/library/.test(url.pathname)) {
			url.pathname = '/v2/library/' + url.pathname.split('/v2/')[1];
		}

		// ---------- 需要先换 token 的请求（manifests/blobs/tags）----------
		const needToken = url.pathname.startsWith('/v2/') && (
			url.pathname.includes('/manifests/') ||
			url.pathname.includes('/blobs/') ||
			url.pathname.includes('/tags/') ||
			url.pathname.endsWith('/tags/list')
		);

		if (needToken) {
			const repoMatch = url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/|$)/);
			const repo = repoMatch ? repoMatch[1] : '';
			if (repo) {
				const tokenUrl = `${auth_url}/token?service=registry.docker.io&scope=repository:${repo}:pull`;
				const tokenHeaders = {
					'User-Agent': getReqHeader("User-Agent"),
					'Accept': getReqHeader("Accept"),
					'Accept-Language': getReqHeader("Accept-Language"),
					'Accept-Encoding': getReqHeader("Accept-Encoding"),
					'Connection': 'keep-alive',
					'Cache-Control': 'max-age=0'
				};
				// 关键：用 Basic Auth 换取认证 token
				if (basicAuth) {
					tokenHeaders['Authorization'] = basicAuth;
				}
				const tokenRes = await fetch(tokenUrl, { headers: tokenHeaders });
				if (!tokenRes.ok) {
					return new Response(tokenRes.body, { status: tokenRes.status, headers: tokenRes.headers });
				}
				const tokenData = await tokenRes.json();
				const registryToken = tokenData.token;

				const headers = {
					'Host': hub_host,
					'User-Agent': getReqHeader("User-Agent"),
					'Accept': getReqHeader("Accept"),
					'Accept-Language': getReqHeader("Accept-Language"),
					'Accept-Encoding': getReqHeader("Accept-Encoding"),
					'Connection': 'keep-alive',
					'Cache-Control': 'max-age=0',
					'Authorization': `Bearer ${registryToken}`
				};
				if (request.headers.has("X-Amz-Content-Sha256")) {
					headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");
				}

				const response = await fetch(new Request(url, request), { headers, cacheTtl: 3600 });
				const newHeaders = new Headers(response.headers);
				if (newHeaders.get("Www-Authenticate")) {
					newHeaders.set("Www-Authenticate", newHeaders.get("Www-Authenticate").replace(new RegExp(auth_url, 'g'), workers_url));
				}
				if (newHeaders.get("Location")) {
					return httpHandler(request, newHeaders.get("Location"), hub_host);
				}
				return new Response(response.body, { status: response.status, headers: newHeaders });
			}
		}

		// ---------- 普通请求（如 /v2/ 索引）----------
		const headers = {
			'Host': hub_host,
			'User-Agent': getReqHeader("User-Agent"),
			'Accept': getReqHeader("Accept"),
			'Accept-Language': getReqHeader("Accept-Language"),
			'Accept-Encoding': getReqHeader("Accept-Encoding"),
			'Connection': 'keep-alive',
			'Cache-Control': 'max-age=0'
		};
		// 客户端自己带的认证优先
		if (request.headers.has("Authorization")) {
			headers['Authorization'] = getReqHeader("Authorization");
		}
		// 对于 Docker Hub，如果客户端没有认证，不强行注入（因为直接注入 PAT 无效）
		// 而是由后续 401 挑战让客户端走认证流程，我们的 /token 端点会带上 Basic Auth。
		if (request.headers.has("X-Amz-Content-Sha256")) {
			headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");
		}

		const response = await fetch(new Request(url, request), { headers, cacheTtl: 3600 });
		const newHeaders = new Headers(response.headers);
		if (newHeaders.get("Www-Authenticate")) {
			newHeaders.set("Www-Authenticate", newHeaders.get("Www-Authenticate").replace(new RegExp(auth_url, 'g'), workers_url));
		}
		if (newHeaders.get("Location")) {
			return httpHandler(request, newHeaders.get("Location"), hub_host);
		}
		return new Response(response.body, { status: response.status, headers: newHeaders });
	}
};

function httpHandler(req, pathname, baseHost) {
	const reqHdrRaw = req.headers;
	if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
		return new Response(null, PREFLIGHT_INIT);
	}
	const reqHdrNew = new Headers(reqHdrRaw);
	reqHdrNew.delete("Authorization");
	const urlObj = newUrl(pathname, 'https://' + baseHost);
	return proxy(urlObj, { method: req.method, headers: reqHdrNew, redirect: 'follow', body: req.body }, '');
}

async function proxy(urlObj, reqInit, rawLen) {
	const res = await fetch(urlObj.href, reqInit);
	const resHdrNew = new Headers(res.headers);
	if (rawLen) {
		const newLen = resHdrNew.get('content-length') || '';
		if (rawLen !== newLen) {
			return makeRes(res.body, 400, { '--error': `bad len: ${newLen}, except: ${rawLen}`, 'access-control-expose-headers': '--error' });
		}
	}
	resHdrNew.set('access-control-expose-headers', '*');
	resHdrNew.set('access-control-allow-origin', '*');
	resHdrNew.set('Cache-Control', 'max-age=1500');
	resHdrNew.delete('content-security-policy');
	resHdrNew.delete('content-security-policy-report-only');
	resHdrNew.delete('clear-site-data');
	return new Response(res.body, { status: res.status, headers: resHdrNew });
}

async function ADD(envadd) {
	var addtext = envadd.replace(/[	 |"'\r\n]+/g, ',').replace(/,+/g, ',');
	if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, addtext.length - 1);
	return addtext.split(',');
}
