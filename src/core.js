/**
 * Encode a single MIME parameter using RFC 2231 extended syntax.
 *
 * RFC 2231 defines two extensions to traditional MIME parameter syntax:
 * continuation parameters (for values too long for a single header line)
 * and character-set/encoding information (for non-ASCII values).
 *
 * This module implements the parameter-value encoding for both cases.
 * The public entry points are encodeParameter and decodeParameter.
 *
 * Design decision:
 * - Non-ASCII values are encoded using RFC 2231's charset'language'percent-encoding
 *   form with UTF-8 as the charset and no language.
 * - Values longer than 78 characters are split into continuation parameters
 *   numbered from 0. The decision to split at 78 characters is based on the
 *   traditional header line length recommendation from RFC 5322, and gives
 *   room for the parameter name, the equals sign, and the section number.
 * - When a value is short enough, the plain RFC 2045 parameter syntax is used
 *   without any RFC 2231 additions.
 * - The encoder does not attempt to fold header lines; it returns parameter
 *   fragments that the caller can place on separate physical lines.
 * - Decoding accepts both plain and extended syntax. It will merge continuation
 *   parameters only when they are presented as a list of already-parsed
 *   parameter name/value pairs. The decodeParameter function decodes a single
 *   value; a separate merge function is not provided because the caller is
 *   responsible for parsing the header itself.
 */

const MAX_LINE_LENGTH = 78;
const HEX = '0123456789ABCDEF';

/**
 * Percent-encode a byte according to RFC 2231.
 *
 * @param {number} byte
 * @returns {string}
 */
function percentEncodeByte(byte) {
  return '%' + HEX[(byte >> 4) & 0x0f] + HEX[byte & 0x0f];
}

/**
 * Percent-encode a string's UTF-8 bytes.
 *
 * @param {string} value
 * @returns {string}
 */
function utf8PercentEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let result = '';
  for (const byte of bytes) {
    if (
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d ||
      byte === 0x2e ||
      byte === 0x5f ||
      byte === 0x7e
    ) {
      result += String.fromCharCode(byte);
    } else {
      result += percentEncodeByte(byte);
    }
  }
  return result;
}

/**
 * Decode a percent-encoded UTF-8 string.
 *
 * @param {string} encoded
 * @returns {string}
 */
function utf8PercentDecode(encoded) {
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i];
    if (ch === '%') {
      if (i + 2 >= encoded.length) {
        throw new Error('Truncated percent-encoding');
      }
      const hex = encoded.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
        throw new Error('Invalid percent-encoding');
      }
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
}

/**
 * Encode a parameter value for use in a MIME header.
 *
 * Returns an array of fragments. Each fragment is an object with:
 *   - name: the parameter name to use in the header
 *   - value: the encoded parameter value
 *
 * If the value is plain ASCII and fits on one line, a single fragment with
 * the original name and value is returned. If the value is non-ASCII, the
 * first fragment uses the extended syntax name*0*=utf-8''... and the value
 * is percent-encoded UTF-8. Long values are split into multiple fragments
 * with names name*0, name*1, etc.
 *
 * @param {string} name - parameter name (must be a valid MIME token)
 * @param {string} value - parameter value
 * @returns {Array<{name: string, value: string}>}
 */
export function encodeParameter(name, value) {
  if (typeof name !== 'string' || typeof value !== 'string') {
    throw new TypeError('name and value must be strings');
  }
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new Error('Invalid parameter name');
  }

  const asciiOnly = /^[\x20-\x7e]*$/.test(value);

  if (asciiOnly && value.length <= MAX_LINE_LENGTH) {
    return [{ name, value }];
  }

  const encoded = asciiOnly ? value : utf8PercentEncode(value);
  const needsExtended = !asciiOnly;
  const fragments = [];
  let start = 0;
  let section = 0;

  while (start < encoded.length || (start === 0 && encoded.length === 0)) {
    const prefixLen = needsExtended && section === 0 ? name.length + 4 : name.length + 2 + String(section).length;
    const available = Math.max(1, MAX_LINE_LENGTH - prefixLen);
    const end = Math.min(start + available, encoded.length);
    const fragmentValue = encoded.slice(start, end);

    if (section === 0 && needsExtended) {
      fragments.push({
        name: `${name}*0*`,
        value: `utf-8''${fragmentValue}`,
      });
    } else if (section === 0) {
      fragments.push({ name: `${name}*0`, value: fragmentValue });
    } else {
      fragments.push({ name: `${name}*${section}`, value: fragmentValue });
    }

    start = end;
    section++;
    if (start >= encoded.length && encoded.length !== 0) break;
    if (encoded.length === 0) break;
  }

  return fragments;
}

/**
 * Decode a single parameter value that may use RFC 2231 extended syntax.
 *
 * Accepts a parameter name and a value string. If the name ends with an
 * asterisk (as in the output of encodeParameter for non-ASCII values), the
 * value is interpreted as extended syntax: charset'language'percent-encoded.
 * Otherwise the value is returned as-is. This function does not merge
 * continuation parameters; callers should parse the header and combine the
 * fragments before calling this function.
 *
 * @param {string} name - parameter name (may include RFC 2231 suffixes)
 * @param {string} value - parameter value from the header
 * @returns {string} decoded value
 */
export function decodeParameter(name, value) {
  if (typeof name !== 'string' || typeof value !== 'string') {
    throw new TypeError('name and value must be strings');
  }

  if (name.endsWith('*')) {
    const firstApostrophe = value.indexOf("'");
    if (firstApostrophe === -1) {
      throw new Error('Malformed extended parameter value');
    }
    const secondApostrophe = value.indexOf("'", firstApostrophe + 1);
    if (secondApostrophe === -1) {
      throw new Error('Malformed extended parameter value');
    }
    const charset = value.slice(0, firstApostrophe);
    if (charset.toLowerCase() !== 'utf-8') {
      throw new Error(`Unsupported charset: ${charset}`);
    }
    const encoded = value.slice(secondApostrophe + 1);
    return utf8PercentDecode(encoded);
  }

  return value;
}
