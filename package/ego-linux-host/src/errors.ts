export function egoError(
  error_code: string,
  message: string,
): Error & { error_code: string } {
  return Object.assign(new Error(message), { error_code });
}
export function invalid(message: string): never {
  throw Object.assign(new TypeError(message), {
    error_code: "EGO_INVALID_ARGUMENT",
  });
}
