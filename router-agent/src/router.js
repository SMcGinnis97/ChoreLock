// TP-Link HB210 Pro admin client over the encrypted /cgi_gdpr?9 endpoint.
//
// Protocol (verified live 2026-08-26 against the unit + its own web UI):
//   - Single endpoint POST /cgi_gdpr?9 (the "?9" ACT_SIG marker is REQUIRED;
//     plain /cgi_gdpr returns error 71014).
//   - Body: `sign=<RSA sig>\r\ndata=<base64 AES-CBC(json)>\r\n`.
//   - Each request carries ONE data-model op as JSON:
//       {"data":{<attrs>,"stack":"0,0,0,0,0,0","pstack":"0,0,0,0,0,0"},
//        "operation":"go|gl|gs|so|ao|do|op|cgi","oid":"<OID>",
//        "stack":"<targetStack>","pstack":"<parentStack>"}
//     (top-level stack/pstack carry the real target; data.* stay at defaults.)
//   - Response: JSON, header-less chunked body:
//       {"data":{...}|[...],"operation":"...","oid":"...","success":true}
//     or, for cgi/set/login: {"success":true,"errorcode":0}.
//   - Login: cgi op on /cgi/login with BOTH UserName and Passwd base64-encoded,
//     Action:1, signed with the is-login handshake (RSA sig carries the AES key).
//   - Auth after login is by client-IP session + a TokenID header (value = the
//     `var token="…"` on the authenticated index page). No cookies.
//   - Web admin is single-session: a second client gets errorcode 71011.
//   - Every request needs Referer + a browser User-Agent or the server 406s.
import net from 'node:net';
import { md5Hex, genAesKey, aesEncrypt, aesDecrypt, buildSignature } from './crypto.js';
import { log } from './log.js';

/** Decode an HTTP chunked-transfer body. Returns the raw buffer on any malformation. */
function dechunk(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let nl = buf.indexOf('\r\n', pos, 'latin1');
    if (nl < 0) break;
    const size = parseInt(buf.toString('latin1', pos, nl).trim(), 16);
    if (Number.isNaN(size)) return buf; // not actually chunked
    if (size === 0) return Buffer.concat(out);
    const start = nl + 2;
    out.push(buf.subarray(start, start + size));
    pos = start + size + 2; // skip data + trailing CRLF
  }
  return out.length ? Buffer.concat(out) : buf;
}

/** True once `body` contains a complete chunked stream (terminating 0-chunk). */
function chunkComplete(body) {
  const s = body.toString('latin1');
  return /\r\n0\r\n\r\n$/.test(s) || s === '0\r\n\r\n' || /(^|\r\n)0\r\n\r\n/.test(s);
}

/**
 * One HTTP request over a raw TCP socket, one socket per request (we close it
 * ourselves after reading the full response — no keep-alive pool to go stale).
 *
 * We send `Connection: keep-alive` on purpose: with `close` this firmware emits
 * a header-less bare-chunked body (which hides the login Set-Cookie and breaks
 * llhttp/undici). With keep-alive it returns a normal HTTP response, so we parse
 * status + headers (incl. Set-Cookie) and read the body by Transfer-Encoding
 * chunked or Content-Length. A header-less reply is still handled as a fallback.
 */
function httpRequest(urlStr, { method = 'POST', body = null, headers = {}, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const reqHead =
      `${method} ${u.pathname}${u.search} HTTP/1.1\r\n` +
      `Host: ${u.host}\r\n` +
      Object.entries({ ...headers, Connection: 'keep-alive' })
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join('') +
      `Content-Length: ${body != null ? Buffer.byteLength(body) : 0}\r\n\r\n`;

    const socket = net.connect(Number(u.port) || 80, u.hostname);
    let buf = Buffer.alloc(0);
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      socket.destroy();
      fn(arg);
    };

    const tryComplete = (closed) => {
      if (buf.length === 0) return closed && finish(reject, new Error('empty response'));

      if (buf.toString('latin1', 0, 5) !== 'HTTP/') {
        // Header-less bare body (only when the server chose to close): use it whole.
        if (closed) finish(resolve, { status: 200, text: dechunk(buf).toString('utf8'), setCookie: [] });
        return;
      }
      const sep = buf.indexOf('\r\n\r\n', 0, 'latin1');
      if (sep < 0) return; // headers still arriving
      const head = buf.toString('latin1', 0, sep);
      const status = Number(head.match(/^HTTP\/\d\.\d (\d+)/)?.[1]) || 0;
      const setCookie = [...head.matchAll(/^set-cookie:\s*(.+)$/gim)].map((m) => m[1].trim());
      const bodyBuf = buf.subarray(sep + 4);

      if (/transfer-encoding:\s*chunked/i.test(head)) {
        if (!closed && !chunkComplete(bodyBuf)) return;
        return finish(resolve, { status, text: dechunk(bodyBuf).toString('utf8'), setCookie });
      }
      const cl = head.match(/content-length:\s*(\d+)/i);
      if (cl) {
        const len = Number(cl[1]);
        if (!closed && bodyBuf.length < len) return;
        return finish(resolve, { status, text: bodyBuf.subarray(0, len).toString('utf8'), setCookie });
      }
      if (closed) finish(resolve, { status, text: bodyBuf.toString('utf8'), setCookie });
    };

    socket.setTimeout(timeoutMs, () => finish(reject, new Error(`request timeout after ${timeoutMs}ms`)));
    socket.on('connect', () => socket.write(reqHead + (body != null ? body : '')));
    socket.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      tryComplete(false);
    });
    socket.on('error', (e) => finish(reject, e));
    socket.on('close', () => tryComplete(true));
  });
}

// Data-model operation codes for this firmware's JSON protocol.
export const OP = { GET: 'go', GETLIST: 'gl', GETSUB: 'gs', SET: 'so', ADD: 'ao', DEL: 'do', ACTION: 'op', CGI: 'cgi' };
const ZERO_STACK = '0,0,0,0,0,0';

// Access Control deny (black) chain + firewall master, verified live.
export const BLACK_CHAIN_STACK = '2,0,0,0,0,0';
const RULE_OID = 'DEV2_FW_CHAIN_RULE';
const CHAIN_OID = 'DEV2_FW_CHAIN';
const FIREWALL_OID = 'DEV2_FIREWALL';
const FIREWALL_STACK = ZERO_STACK;

const ERR_OK = 0;
const ERR_SESSION_CONFLICT = 71011; // another client is already logged in (single-session)
const ERR_RULETYPE_GUARD = 4724; // firmware refuses an enforcing (RuleType=2) rule from a scripted session
// Codes seen when the session is gone / request rejected for auth; trigger a re-login.
const AUTH_ERRORS = new Set([71017, 71018, 71019, 71020]);

/** Parse a decrypted JSON response into { success, errorcode, data, operation, oid }. */
export function parseResponse(text) {
  const j = JSON.parse(text.replace(/\0+$/, '').trim());
  return {
    success: j.success !== false,
    errorcode: typeof j.errorcode === 'number' ? j.errorcode : ERR_OK,
    data: j.data,
    operation: j.operation,
    oid: j.oid,
  };
}

export class RouterClient {
  constructor({ host, username, password, rsaPadding = 'none' }) {
    this.host = host;
    this.base = `http://${host}`;
    this.username = username;
    this.password = password;
    this.rsaPadding = rsaPadding;
    this.md5Pw = md5Hex(username + password);

    this.rsaKey = null; // {n, e}
    this.seq = null;
    this.aes = null; // {key, iv}
    this.token = null; // TokenID header value
    this.cookie = null; // JSESSIONID (httpOnly session cookie from login)
  }

  get loggedIn() {
    return !!(this.aes && this.token);
  }

  headers(extra = {}) {
    const h = {
      Accept: '*/*',
      'Content-Type': 'text/plain',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      Referer: `${this.base}/`,
      ...extra,
    };
    // Auth = JSESSIONID cookie (set at login) + TokenID header on data-model ops.
    if (this.cookie) h.Cookie = this.cookie;
    if (this.token) h.TokenID = this.token;
    return h;
  }

  captureCookie(setCookie) {
    for (const c of setCookie || []) {
      const m = c.match(/JSESSIONID=([^;]+)/);
      if (m && m[1] !== 'deleted') this.cookie = `JSESSIONID=${m[1]}`;
    }
  }

  async raw(path, { method = 'POST', body = null, headers = {} } = {}) {
    const res = await httpRequest(`${this.base}/${path}`, { method, body, headers: this.headers(headers) });
    this.captureCookie(res.setCookie);
    return res;
  }

  /** Encrypt+sign a plaintext body and POST it; return the decrypted text. */
  async cgiGdpr(plaintext, { isLogin = false } = {}) {
    const encrypted = aesEncrypt(plaintext, this.aes);
    const sign = buildSignature({
      isLogin,
      aes: this.aes,
      md5Pw: this.md5Pw,
      seq: this.seq,
      bodyLen: encrypted.length,
      rsaKey: this.rsaKey,
      padding: this.rsaPadding,
    });
    const body = `sign=${sign}\r\ndata=${encrypted}\r\n`;
    const { status, text } = await this.raw('cgi_gdpr?9', { body });
    if (status !== 200 && status !== 0) throw new SessionError(`cgi_gdpr HTTP ${status}`);
    try {
      return aesDecrypt(text, this.aes);
    } catch {
      // A dropped session returns the (unencrypted) login page instead of ciphertext.
      throw new SessionError('cgi_gdpr response was not decryptable (session likely dropped)');
    }
  }

  /**
   * Build the JSON body for one data-model op, matching the web UI's placement:
   * add/set/del carry the target stack at TOP LEVEL; getSubList carries the parent
   * stack inside data.pstack. `dataStack`/`dataPstack` override the in-data values.
   */
  static payload(operation, oid, { stack, pstack, data = {}, dataStack = ZERO_STACK, dataPstack = ZERO_STACK, top = {} } = {}) {
    const obj = { data: { ...data, stack: dataStack, pstack: dataPstack }, operation, oid, ...top };
    if (stack !== undefined) obj.stack = stack;
    if (pstack !== undefined) obj.pstack = pstack;
    return JSON.stringify(obj) + '\r\n';
  }

  // ---- login handshake ----

  async fetchParm() {
    for (const path of ['cgi/getGDPRParm', 'cgi/getParm']) {
      const { status, text } = await this.raw(path, { body: null });
      if (status !== 200) continue;
      const ee = text.match(/var ee="([^"]+)"/);
      const nn = text.match(/var nn="([^"]+)"/);
      const seq = text.match(/var seq="?(\d+)"?/);
      if (ee && nn && seq) return { e: ee[1], n: nn[1], seq: Number(seq[1]) };
    }
    throw new Error('Could not read RSA params (ee/nn/seq) from the router.');
  }

  async getBusy() {
    const { text } = await this.raw('cgi/getBusy', { body: null });
    const logged = text.match(/var isLogined=([01])/);
    const busy = text.match(/var isBusy=([01])/);
    return { isLogined: logged ? logged[1] === '1' : false, isBusy: busy ? busy[1] === '1' : false };
  }

  async login() {
    this.token = null;
    this.cookie = null;
    const parm = await this.fetchParm();
    this.rsaKey = { n: parm.n, e: parm.e };
    this.seq = parm.seq;
    this.aes = genAesKey();

    // BOTH username and password are base64-encoded in the body; the MD5 auth
    // hash inside the signature uses the RAW username+password. On this firmware
    // the single-admin login name is "user" (not "admin"). Action is a STRING and
    // login carries no top-level stack/pstack (matched to the web UI's request).
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const body = JSON.stringify({
      data: { UserName: b64(this.username), Passwd: b64(this.password), Action: '1', stack: ZERO_STACK, pstack: ZERO_STACK },
      operation: OP.CGI,
      oid: '/cgi/login',
    }) + '\r\n';
    const decoded = await this.cgiGdpr(body, { isLogin: true });

    // Success comes back as `$.ret=0;`; failures as JSON {"success":false,"errorcode":N}.
    const retM = decoded.match(/\$\.ret=(-?\d+)/);
    if (retM) {
      if (Number(retM[1]) !== ERR_OK) throw new LoginError(`Login rejected (ret=${retM[1]}).`);
    } else {
      let res;
      try {
        res = parseResponse(decoded);
      } catch {
        throw new LoginError(`Unexpected login response: ${decoded.slice(0, 120)}`);
      }
      if (!res.success) {
        if (res.errorcode === ERR_SESSION_CONFLICT) throw new SessionConflictError(res.errorcode);
        throw new LoginError(`Login rejected (errorcode=${res.errorcode}). Check the admin password.`);
      }
    }
    this.token = await this.fetchToken();
    if (!this.token) throw new LoginError('Logged in but could not read the TokenID from the index page.');
    log.info(`Router login OK (${this.host}).`);
  }

  /** The authenticated index page inlines `var token="…"` — that is the TokenID. */
  async fetchToken() {
    const { text } = await this.raw('', { method: 'GET', body: null });
    return text.match(/var token="([^"]+)"/)?.[1] || null;
  }

  async logout() {
    if (!this.token) return;
    try {
      await this.cgiGdpr(RouterClient.payload(OP.CGI, '/cgi/logout'));
    } catch (e) {
      log.debug('logout error (ignored):', e.message);
    }
    this.token = null;
    this.aes = null;
    this.cookie = null;
  }

  /**
   * Run one op, transparently re-logging-in once if the session dropped.
   * Throws SessionConflictError up to the caller (do NOT force out a human).
   */
  async run(operation, oid, opts = {}) {
    if (!this.loggedIn) await this.login();
    const send = async () => parseResponse(await this.cgiGdpr(RouterClient.payload(operation, oid, opts)));
    let res;
    try {
      res = await send();
    } catch (e) {
      if (!(e instanceof SessionError)) throw e;
      log.warn('Session dropped; re-logging in and retrying once.');
      this.token = null;
      this.aes = null;
      await this.login();
      res = await send();
    }
    if (!res.success && AUTH_ERRORS.has(res.errorcode)) {
      log.warn(`Auth error ${res.errorcode}; re-logging in and retrying once.`);
      this.token = null;
      this.aes = null;
      await this.login();
      res = await send();
    }
    return res;
  }

  // ---- Access Control primitives ----

  /** Current deny-list rules under the BLACK chain: [{ stack, name, mac, enable }]. */
  async readDenyList() {
    // getSubList carries the parent (BLACK chain) stack in data.pstack, no top-level.
    const res = await this.run(OP.GETSUB, RULE_OID, { dataPstack: BLACK_CHAIN_STACK });
    const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    return rows.map((o) => ({
      stack: o.stack,
      name: o.X_TP_RuleName || '',
      mac: (o.X_TP_SourceMACAddress || '').toUpperCase(),
      enable: o.enable === '1',
    }));
  }

  /** Add an ENABLED, MAC-matching (X_TP_RuleType=2) Drop rule under the BLACK chain. */
  async addDenyRule(mac, name) {
    // The router only accepts a RuleType=2 add if the black-chain context was just
    // read — a getSubList immediately before the add (no writes in between), matching
    // the web UI's flow. Without this prime the add fails with error 4724, and a rule
    // added without RuleType=2 exists but never actually enforces.
    await this.run(OP.GETSUB, RULE_OID, { dataPstack: BLACK_CHAIN_STACK });
    const res = await this.run(OP.ADD, RULE_OID, {
      dataPstack: BLACK_CHAIN_STACK,
      top: { isuseractive: true },
      data: {
        enable: '1',
        X_TP_RuleType: '2',
        X_TP_RuleName: name,
        X_TP_SourceType: '2',
        sourceIP: '',
        X_TP_SourceMACAddress: mac,
        target: 'Drop',
      },
    });
    const stack = res.data?.stack;
    if (!stack) {
      if (res.errorcode === ERR_RULETYPE_GUARD) {
        // KNOWN FIRMWARE LIMITATION: the HB210 Pro only grants X_TP_RuleType=2
        // (required for the deny rule to actually match/enforce) to a genuinely
        // interactive browser session — a scripted add is rejected with 4724.
        // A rule added without RuleType=2 exists but never cuts WAN, so we refuse
        // and fail open rather than create a misleading no-op rule. See README.
        throw new Error(
          `Router refused an enforcing deny rule for ${mac} (err 4724 — firmware only allows interactive rule creation). Failing open. See README "Known limitation".`,
        );
      }
      throw new Error(`add rule for ${mac} failed (success=${res.success}, err=${res.errorcode})`);
    }
    return stack;
  }

  async enableRule(stack, on = true) {
    // set carries the target rule's stack inside data.stack (per the web UI).
    const res = await this.run(OP.SET, RULE_OID, { dataStack: stack, data: { enable: on ? '1' : '0' } });
    if (!res.success) throw new Error(`enable rule ${stack} failed (err=${res.errorcode})`);
  }

  async delRule(stack) {
    const res = await this.run(OP.DEL, RULE_OID, { dataStack: stack });
    if (!res.success) throw new Error(`delete rule ${stack} failed (err=${res.errorcode})`);
  }

  // Read-only/computed firewall fields that must NOT be written back.
  static FIREWALL_READONLY = new Set(['version', 'levelNumberOfEntries', 'chainNumberOfEntries', 'config', 'advancedLevel']);

  /**
   * Enable/disable the ACL master AND commit pending rules. Writing the WHOLE
   * DEV2_FIREWALL object back (as the web UI's doEnableACL does) triggers the
   * firewall reconfigure that flips each rule's X_TP_SetAlready 0->1 (a 2-field
   * set does not — the rule then never actually enforces).
   */
  async setAclMaster(on) {
    const cur = await this.run(OP.GET, FIREWALL_OID, { dataStack: FIREWALL_STACK, data: {} });
    const data = {};
    for (const [k, v] of Object.entries(cur.data || {})) {
      if (!RouterClient.FIREWALL_READONLY.has(k)) data[k] = v;
    }
    data.X_TP_EnableACL = on ? '1' : '0';
    data.X_TP_ACLMode = '1'; // 1 = deny/blacklist mode
    const res = await this.run(OP.SET, FIREWALL_OID, { dataStack: FIREWALL_STACK, data });
    if (!res.success) throw new Error(`set ACL master ${on ? 'on' : 'off'} failed (err=${res.errorcode})`);
  }

  async readAclMaster() {
    const res = await this.run(OP.GET, FIREWALL_OID, {
      dataStack: FIREWALL_STACK,
      data: { X_TP_EnableACL: '', X_TP_ACLMode: '' },
    });
    return res.data?.X_TP_EnableACL === '1';
  }
}

export class SessionError extends Error {}
export class LoginError extends Error {}
export class SessionConflictError extends LoginError {
  constructor(code) {
    super(`Another session is already logged in (errorcode=${code}). Log out the router web UI, or wait for its idle timeout.`);
  }
}
