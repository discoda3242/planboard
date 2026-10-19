// GitHub for the hub: the board acts as a GitHub App on the code repo — it reads pull requests and check results,
// posts its own "planboard" status, and merges. Also verifies webhook signatures. Web Crypto only (Workers and Node 20+).

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(enc.encode(s));

// GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); Web Crypto wants PKCS#8. Wrap it.
function derLen(n) { if (n < 128) return [n]; const b = []; while (n) { b.unshift(n & 255); n >>= 8; } return [0x80 | b.length, ...b]; }
const der = (tag, bytes) => [tag, ...derLen(bytes.length), ...bytes];
function pemToPkcs8(pem) {
  const body = String(pem).replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!/BEGIN RSA PRIVATE KEY/.test(pem)) return raw;
  const algo = der(0x30, [...der(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]), 0x05, 0x00]);
  return new Uint8Array(der(0x30, [...der(0x02, [0]), ...algo, ...der(0x04, [...raw])]));
}

export async function appJwt(appId, pem, now = Date.now()) {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const t = Math.floor(now / 1000);
  const data = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64urlStr(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) }));
  return data + '.' + b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data)));
}

export async function verifyWebhook(secret, body, sig) {
  if (!secret || !sig || !sig.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const want = sig.slice(7); if (want.length !== mac.length) return false;
  let d = 0; for (let i = 0; i < mac.length; i++) d |= mac.charCodeAt(i) ^ want.charCodeAt(i); return d === 0;
}

// api(method, path, body) for one repo, authenticated as the app's installation (token cached ~50 min)
export function githubClient({ appId, key, repo, fetchFn = fetch }) {
  let tok = null, exp = 0;
  const call = async (method, url, auth, body) => {
    const r = await fetchFn('https://api.github.com' + url, { method, headers: { Authorization: auth, Accept: 'application/vnd.github+json', 'User-Agent': 'planboard-hub', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) { const e = new Error(`GitHub ${method} ${url.split('?')[0]}: ${r.status} ${(j && j.message) || text.slice(0, 120)}`); e.status = r.status; throw e; }
    return j;
  };
  async function token() {
    if (tok && Date.now() < exp) return tok;
    const jwt = 'Bearer ' + (await appJwt(appId, key));
    const inst = await call('GET', `/repos/${repo}/installation`, jwt);
    const t = await call('POST', `/app/installations/${inst.id}/access_tokens`, jwt, { repositories: [repo.split('/')[1]] });
    tok = t.token; exp = Date.now() + 50 * 60e3; return tok;
  }
  return async (method, path, body) => call(method, `/repos/${repo}${path}`, 'Bearer ' + (await token()), body);
}
