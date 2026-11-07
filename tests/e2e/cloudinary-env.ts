// Fake Cloudinary account for the E2E app server only. The browser's calls to Cloudinary are intercepted
// in the tests (and the signature is checked with this secret); nothing reaches the real Cloudinary.
export const E2E_CLOUDINARY = {
  CLOUDINARY_CLOUD_NAME: "ife-test",
  CLOUDINARY_API_KEY: "111222333",
  CLOUDINARY_API_SECRET: "e2e-only-secret",
};
