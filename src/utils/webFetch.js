/**
 * Simple HTTP fetch utility for server-side use.
 * Wraps native Node.js fetch with error handling.
 */
export async function webFetch(url, options = {}) {
  try {
    const response = await fetch(url, {
      timeout: 8000,
      ...options,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[webFetch] Failed to fetch ${url}:`, error.message);
    return null;
  }
}
