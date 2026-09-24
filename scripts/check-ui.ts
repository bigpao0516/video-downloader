// Check syntax without executing the browser code or starting a download.
const html = await Deno.readTextFile(new URL("../public/index.html", import.meta.url));
const scripts = [...html.matchAll(/<script\s*>([\s\S]*?)<\/script>/gi)];

if (scripts.length !== 1) {
  throw new Error(`Expected one inline UI script, found ${scripts.length}.`);
}

new Function(scripts[0][1]);
console.log("Browser script syntax: OK");
