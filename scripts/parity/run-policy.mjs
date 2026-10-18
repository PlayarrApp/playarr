export function dpadAttempts({ failFast, reference }) {
  return failFast ? 1 : reference ? 5 : 3;
}

export function routeAttempts({ failFast, attempts = 2 }) {
  return failFast ? 1 : attempts;
}
