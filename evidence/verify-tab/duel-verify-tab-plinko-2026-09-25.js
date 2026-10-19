// Code written in javascript

// User input values
const clientSeed = '';
const serverSeed = '';
const nonce = 0;
const rows = 8;

// Converts a hex string (e.g. "deadbeef") into a Uint8Array of bytes
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Converts a Uint8Array of bytes back into a hex string (e.g. [222, 173, 190, 239] → "deadbeef")
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Computes a HMAC-SHA256 using the Web Crypto API
// keyHex: hex-encoded key (e.g. server seed)
// message: Uint8Array to be signed
async function generateHMAC_SHA256(keyHex, message) {
  const keyBytes = hexToBytes(keyHex);

  // Import raw key for HMAC use
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Generate HMAC signature
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return bytesToHex(new Uint8Array(signature)); // Return signature as hex
}

// The actual fairness verification function
const validatePlinkoResult = async (serverSeed, clientSeed, nonce, rows) => {
  // Simulate each bounce by generating a new hash for each row with incrementing cursor
  let position = 0;

  for (let cursor = 0; cursor < rows; cursor++) {
    // Generate a new hash for this bounce using cursor
    const message = new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor}`);
    const bounceHash = await generateHMAC_SHA256(serverSeed, message);

    // Extract first 4 bytes for the bounce decision
    const value = parseInt(bounceHash.slice(0, 8), 16);

    // Add 1 for right movement, 0 for left.
    // No modulo bias here since 2^32 is evenly divisible by 2.
    position += (value % 2);
  }

  return position;
}

// Execute the verification
if (serverSeed && serverSeed.trim() !== '' && clientSeed && clientSeed.trim() !== '' && nonce >= 0 && rows >= 8 && rows <= 16) {
  validatePlinkoResult(serverSeed, clientSeed, nonce, rows).then(result => {
    console.log('Plinko bucket (final slot):', result);
    console.log('Ball landed in bucket', result, 'out of', rows + 1, 'total buckets (0 to ' + rows + ')');
  });
} else {
  console.log("Please provide valid serverSeed, clientSeed, nonce (>=0), and rows (8-16 inclusive) before running.");
}
