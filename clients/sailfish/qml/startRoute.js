.pragma library

function initialRoute(signedIn, profileCount) {
    if (signedIn)
        return profileCount > 1 ? "profiles" : "main"
    return profileCount > 0 ? "profiles" : "link"
}
