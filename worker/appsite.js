// Apple's app-site file, /.well-known/apple-app-site-association. remmynd for iPhone may use passkeys for this site
// (webcredentials) and opens shared reminder links itself when it's installed (applinks). Public by design; nothing
// about anyone in it. (Its own module: the Worker's main module may export only handlers.)

/** The iPhone app's id: the Apple team and the bundle id. */
export const IOS_APP = "TT8BA4JZW6.space.remmynd.app";

export const APP_SITE = {
  webcredentials: { apps: [IOS_APP] },
  applinks: { details: [{ appIDs: [IOS_APP], components: [{ "/": "/r/*" }, { "/": "/new" }, { "/": "/new/*" }, { "/": "/x/*" }, { "/": "/d/*" }, { "/": "/dare/*" }, { "/": "/f/*" }] }] }
};

export function appSiteResponse(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  return new Response(JSON.stringify(APP_SITE), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
}
