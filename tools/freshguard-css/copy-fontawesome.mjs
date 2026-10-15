// Vendor Font Awesome (CSS + webfonts) into static/ so the page works offline / without CDNs.
import { cpSync, mkdirSync } from "fs";
const src = "node_modules/@fortawesome/fontawesome-free";
const dest = "../../static/vendor/fontawesome";
mkdirSync(`${dest}/css`, { recursive: true });
cpSync(`${src}/css/all.min.css`, `${dest}/css/all.min.css`);
cpSync(`${src}/webfonts`, `${dest}/webfonts`, { recursive: true });
cpSync(`${src}/LICENSE.txt`, `${dest}/LICENSE.txt`);
console.log("Font Awesome copied to", dest);
