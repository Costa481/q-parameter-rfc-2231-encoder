# RFC 2231 Parameter Encoder

Encodes and decodes MIME parameter values using RFC 2231 continuation and charset syntax.

```javascript
import { encodeParameter, decodeParameter } from './src/index.js';

const fragments = encodeParameter('filename', 'café.txt');
// [{ name: 'filename*0*', value: "utf-8''caf%C3%A9.txt" }]

const decoded = decodeParameter('filename*', "utf-8''caf%C3%A9.txt");
// 'café.txt'
```

## Why this exists

RFC 2045 MIME parameter values are limited to ASCII and cannot contain many special characters. RFC 2231 adds two mechanisms: a way to declare the character set of a non-ASCII value, and a way to split long values into multiple numbered fragments. This library implements those mechanisms for a single parameter. It does not parse or generate entire header lines; it operates on one parameter name and value at a time.

The trade-off is simplicity: the encoder always uses UTF-8 for non-ASCII values and does not attempt to preserve an original language tag. It also splits values at a fixed line-length threshold rather than trying to account for the full header context. Callers that need to fit a value into a specific header line must handle folding themselves.

## Edge cases

- Parameter names must be valid MIME tokens (ASCII letters, digits, and a small set of punctuation). Invalid names throw an error.
- Extended syntax values must use UTF-8. The decoder rejects other charsets with an error.
- The encoder splits long values at 78 characters, which may leave a final fragment shorter than the others. Continuation fragments are numbered starting at zero; the first fragment of a non-ASCII value uses the `name*0*` extended form while subsequent fragments use plain `name*1`, `name*2`, etc.
- Decoding a single fragment is the caller's responsibility after merging continuation fragments. `decodeParameter` decodes one value and does not combine fragments.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

