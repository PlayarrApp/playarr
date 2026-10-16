// Babel config for both Metro (device/virtual-device bundling) and Jest
// (babel-jest picks this file up automatically -- see jest.config.json,
// which deliberately sets no `transform` of its own so there is exactly one
// place JSX/TS transform rules are defined).
// Build-time settings: `process.env.PLAYARR_<NAME>` for the names below is replaced by its value at bundle time (by
// `undefined` when unset), so a bench or capture build is configured by the environment and needs no source patch:
//   PLAYARR_HOSTED_LINK_ORIGIN=http://broker.example:8080  the hosted-link broker (default https://playarr.app)
//   PLAYARR_PARITY_CLOCK=2026-10-07T12:00:00Z              freeze the app clock (parity captures only)
//   PLAYARR_PARITY_CONTROL=1                               compile in the parity suite's control channel (src/debug/parityControl.ts)
//   PLAYARR_PARITY_ANIMATIONS_DISABLED=1                   assert native motion is disabled for deterministic captures
// Jest keeps the live process.env (no inlining under Jest), so tests can set them.
const BUILD_TIME_SETTINGS = ['PLAYARR_HOSTED_LINK_ORIGIN', 'PLAYARR_PARITY_CLOCK', 'PLAYARR_PARITY_CONTROL', 'PLAYARR_PARITY_ANIMATIONS_DISABLED', 'PLAYARR_PARITY_BUILD_ID'];

function inlineBuildTimeSettings({types: t}) {
  return {
    visitor: {
      MemberExpression(path) {
        if (process.env.JEST_WORKER_ID) return;
        for (const name of BUILD_TIME_SETTINGS) {
          if (!path.matchesPattern(`process.env.${name}`)) continue;
          const value = process.env[name];
          path.replaceWith(value ? t.stringLiteral(value) : t.identifier('undefined'));
          return;
        }
      },
      CallExpression(path) {
        if (process.env.JEST_WORKER_ID || process.env.PLAYARR_PARITY_ANIMATIONS_DISABLED !== '1') return;
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object, {name: 'Animated'}) || !t.isIdentifier(callee.property, {name: 'timing'})) return;
        const options = path.node.arguments[1];
        if (!t.isObjectExpression(options)) return;
        const duration = options.properties.find((property) => t.isObjectProperty(property) && t.isIdentifier(property.key, {name: 'duration'}));
        if (duration && t.isObjectProperty(duration)) duration.value = t.numericLiteral(0);
        else options.properties.push(t.objectProperty(t.identifier('duration'), t.numericLiteral(0)));
      },
    },
  };
}

module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    inlineBuildTimeSettings,
    // @amazon-devices/react-native-w3cmedia's KeplerVideoView expects the
    // classic (`React.createElement`) JSX runtime rather than the automatic
    // one metro-react-native-babel-preset defaults to on RN 0.72 -- without
    // this plugin, any file that renders it fails at bundle time with a
    // missing-React-in-scope error rather than at typecheck time, because
    // tsconfig.json's `"jsx": "react-native"` setting has no automatic-vs-
    // classic runtime distinction of its own to catch it. Declared here,
    // once, rather than in every screen that ends up importing that
    // component.
    '@babel/plugin-transform-react-jsx',
  ],
};
