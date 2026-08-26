// TP-Link "GDPR" (cgi_gdpr) crypto — AES-CBC body + RSA-signed header.
// Ported from the proven reference clients (Electry TD-W9960 + this router's own
// tpEncrypt.js in X:\router-recon). See README for provenance.
import crypto from 'node:crypto';

const AES_KEY_LEN = 16; // 128-bit
const AES_IV_LEN = 16;

/** MD5(username+password) as a 32-char lowercase hex string. */
export function md5Hex(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

/**
 * Generate the per-session AES key/iv the same way the router's JS does:
 * ASCII digits from the current time plus a random tail, sliced to 16 chars.
 * @returns {{key: string, iv: string}}
 */
export function genAesKey() {
  const ts = String(Date.now());
  const rnd = () => String(Math.floor(100000000 + Math.random() * (1000000000 - 100000000)));
  const key = (ts + rnd()).slice(0, AES_KEY_LEN);
  const iv = (ts + rnd()).slice(0, AES_IV_LEN);
  return { key, iv };
}

/** AES-128-CBC + PKCS7, base64 out. key/iv are 16-char ASCII strings. */
export function aesEncrypt(plaintext, { key, iv }) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

/** Inverse of aesEncrypt. Returns UTF-8 string. */
export function aesDecrypt(b64, { key, iv }) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  const buf = Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]);
  return buf.toString('utf8');
}

function rsaPublicKeyFromHex(nHex, eHex) {
  // JWK wants base64url of the big-endian magnitude bytes.
  const n = Buffer.from(nHex.length % 2 ? '0' + nHex : nHex, 'hex').toString('base64url');
  const e = Buffer.from(eHex.length % 2 ? '0' + eHex : eHex, 'hex').toString('base64url');
  return crypto.createPublicKey({ key: { kty: 'RSA', n, e }, format: 'jwk' });
}

/**
 * RSA-sign the header string, chunked to fit the modulus, hex-concatenated —
 * exactly the scheme in tpEncrypt.js / the reference python client.
 * @param {string} signData  e.g. "key=..&iv=..&h=..&s=.." (login) or "h=..&s=.."
 * @param {{n: string, e: string}} rsaKey  hex modulus + exponent
 * @param {'none'|'pkcs1'} padding
 * @returns {string} lowercase hex signature
 */
export function rsaSign(signData, rsaKey, padding = 'none') {
  const pub = rsaPublicKeyFromHex(rsaKey.n, rsaKey.e);
  const byteLen = Math.ceil(rsaKey.n.length / 2); // 128 hex -> 64 bytes
  const usePkcs1 = padding === 'pkcs1';
  const step = usePkcs1 ? byteLen - 11 : byteLen;

  let out = '';
  for (let pos = 0; pos < signData.length; pos += step) {
    const chunkStr = signData.slice(pos, pos + step);
    let enc;
    if (usePkcs1) {
      enc = crypto.publicEncrypt(
        { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(chunkStr, 'utf8'),
      );
    } else {
      // Raw textbook RSA: zero-pad the chunk (at the END, low-order) to the
      // modulus size and encrypt m^e mod n with NO padding.
      const block = Buffer.alloc(byteLen);
      Buffer.from(chunkStr, 'utf8').copy(block, 0);
      enc = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_NO_PADDING }, block);
    }
    out += enc.toString('hex').padStart(byteLen * 2, '0');
  }
  return out;
}

/**
 * Build the login/non-login signature header string, then RSA-sign it.
 * seq = server seq + length of the encrypted body (replay protection).
 */
export function buildSignature({ isLogin, aes, md5Pw, seq, bodyLen, rsaKey, padding }) {
  const s = seq + bodyLen;
  const signData = isLogin
    ? `key=${aes.key}&iv=${aes.iv}&h=${md5Pw}&s=${s}`
    : `h=${md5Pw}&s=${s}`;
  return rsaSign(signData, rsaKey, padding);
}
