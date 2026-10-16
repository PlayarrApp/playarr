export function signedInProfileProbe() {
  return "js:Api.request('GET','/api/v1/users/profiles',null,function(st,p){var profiles=Array.isArray(p)?p:[];var current=profiles.filter(function(x){return x.is_current===true});console.log('PARITY_SIGNED_IN_USER',st,current.length===1&&current[0].username)})";
}

const CONFIGURED_USERNAME = /^[^\s\u0000-\u001f\u007f]{1,128}$/;

/** Parse the signed-in app's current profile; token presence is not identity proof. */
export function verifiedDeviceTestUser(log, expected) {
  if (typeof expected !== "string" || !CONFIGURED_USERNAME.test(expected)) return false;
  const match = String(log).match(/PARITY_SIGNED_IN_USER\s+200\s+(\S+)/);
  return Boolean(match && match[1] === expected);
}
