// Create a password hash for ADMIN_PASSWORD_HASH / VIEWER_PASSWORD_HASH.
// Usage: node scripts/hash-password.cjs "the-new-password"
const { randomBytes, scryptSync } = require("node:crypto");

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Usage: node scripts/hash-password.cjs "password-of-8+-characters"');
  process.exit(1);
}
const salt = randomBytes(16);
console.log(`scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`);
