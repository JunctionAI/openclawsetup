/**
 * Encryption utilities for sensitive data (Telegram tokens, etc.)
 * Uses AES-256-GCM for authenticated encryption
 */

const crypto = require('crypto');

// Encryption key from environment (generate with: openssl rand -hex 32)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  console.error('⚠️ WARNING: ENCRYPTION_KEY not set - tokens will be stored in plaintext!');
}

/**
 * Encrypt sensitive data using AES-256-GCM
 * 
 * @param {string} plaintext - Data to encrypt
 * @returns {string} Encrypted data as base64 (iv:authTag:ciphertext)
 */
function encrypt(plaintext) {
  if (!ENCRYPTION_KEY) {
    // In development without key, return prefixed plaintext (NOT for production!)
    return `plain:${plaintext}`;
  }

  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag().toString('base64');
  
  // Format: iv:authTag:ciphertext (all base64)
  return `enc:${iv.toString('base64')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt data encrypted with encrypt()
 * 
 * @param {string} encryptedData - Encrypted string from encrypt()
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedData) {
  if (!encryptedData) {
    return null;
  }

  // Handle plaintext fallback (development only)
  if (encryptedData.startsWith('plain:')) {
    return encryptedData.substring(6);
  }

  if (!encryptedData.startsWith('enc:')) {
    throw new Error('Invalid encrypted data format');
  }

  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY required to decrypt data');
  }

  const parts = encryptedData.substring(4).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivBase64, authTagBase64, ciphertext] = parts;
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};
