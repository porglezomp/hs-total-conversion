const express = require("express");
const bodyParser = require("body-parser");
const { URL } = require("url");
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const multiparty = require("multiparty");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const path = require("path");
const basicAuth = require("express-basic-auth");
const hsts = require("hsts");
const db = require('./dbhelpers');
const modify = require('./modifypage');
const escape = require('escape-html');

const sixtyDaysInSeconds = 5184000;

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(
  hsts({
    maxAge: sixtyDaysInSeconds
  })
);
const AUTH = basicAuth({
  users: {
    [process.env.USERNAME]: process.env.PASSWORD
  },
  challenge: true
});

fs.promises.mkdir(".data/storyfiles", {
  recursive: true
});

function hashForFile(path) {
  const fd = fs.createReadStream(path);
  const hash = crypto.createHash("sha256");
  hash.setEncoding("hex");
  fd.pipe(hash);
  return new Promise((resolve, reject) => {
    fd.on("end", () => {
      hash.end();
      resolve(hash.read());
    });
  });
}

// @TODO: IP rate-limiting
app.post("/api/upload-image", async (req, res) => {
  const form = new multiparty.Form();
  form.parse(req, async (err, fields, files) => {
    const forUrl = new URL(fields.url[0], "https://homestuck.com").pathname;
    const file = files.image[0];
    if (file.size > modify.FILE_SIZE_LIMIT) {
      res.sendStatus(400);
      return;
    }
    const hash = await hashForFile(file.path);
    const extension = path.extname(file.path);
    const fileName = hash + extension;
    const filePath = path.join(".data", "storyfiles", fileName);

    await fs.promises.copyFile(file.path, filePath);
    await db.run(
      `INSERT OR REPLACE INTO Images
    (for_url, filename, on_page, credits, contact)
    VALUES (?, ?, ?, ?, ?)`,
      forUrl,
      fileName,
      fields.pageUrl[0],
      fields.credits[0],
      fields.contact[0]
    );
    console.log("UPLOADED IMAGE: ", forUrl);
    res.sendStatus(201);
  });
});

app.put("/api/accept", AUTH, async (req, res) => {
  await db.run(
    `UPDATE OR IGNORE Images
   SET accepted = 1
 WHERE for_url = ? AND filename = ?`,
    req.body.url,
    req.body.filename
  );
  console.log("ACCEPTED IMAGE: ", req.body.url, req.body.filename);
  res.sendStatus(204);
});

app.delete("/api/reject", AUTH, async (req, res) => {
  await db.run(
    `UPDATE OR IGNORE Images
   SET blocked = 1
 WHERE for_url = ? AND filename = ?`,
    req.body.url,
    req.body.filename
  );
  console.log("REJECTED IMAGE: ", req.body.url, req.body.filename);
  res.sendStatus(204);
});

app.get("/admin", AUTH, async (req, res) => {
  // @TODO: Template engine?
  try {
  const rows = await db.all(`SELECT * FROM Images AS Im_a
 WHERE NOT blocked AND NOT accepted
   AND NOT EXISTS (
       SELECT 1 FROM Images as Im_b
        WHERE Im_a.for_url = Im_b.for_url
          AND Im_b.accepted
       )
 ORDER BY LENGTH(on_page),on_page;`);
  let body = `<html>
<head>
<style>
.spacer { flex-grow: 1; }
.line { flex-basis: 0.5em; }
.row { display: flex; flex-direction: row; }
.col { display: flex; flex-direction: column; }
ul { padding: 0; }
li { margin-bottom: 5em; }
img { object-fit: contain; }
body { max-width: 900px; min-height: 100vh; margin: 0 auto; padding: 1em; }
</style>
</head>
<body>
  <h1>Admin Page</h1>`;
  const $ = cheerio.load('<ul class="col"></ul>');
  for (const row of rows) {
    const refUrl = row.for_url;
    const newUrl = '/calibornstuck/' + row.filename;

    const entry = $('<li class="col">');
    const heading = $('<h3>')
      .append($('<span>').text(row.for_url))
      .append(" - ")
      .append($('<a>').attr('href', row.on_page).text(row.on_page));
    const images = $('<div class="row">')
      .append($('<img>').attr('src', refUrl))
      .append($('<img>').attr('src', newUrl));
    const imageLabels = $('<div class="row">')
      .append('<div class="spacer"></div>')
      .append($('<div><span class="width">width</span>x<span class="height">height</span></div>')
        .attr('data-img', refUrl))
      .append('<div class="spacer"></div>')
      .append($('<div><span class="width">width</span>x<span class="height">height</span></div>')
        .attr('data-img', newUrl))
      .append('<div class="spacer"></div>');
    const info = $('<div class="row">')
      .append('<div class="spacer"></div>')
      .append($('<div>').text(`Contact info: ${row.contact}`))
      .append('<div class="spacer"></div>')
      .append($('<div>').text(`Credits: ${row.credits}`))
      .append('<div class="spacer"></div>');
    const buttons = $('<div class="row"></div>')
      .append('<div class="spacer"></div>')
      .append($('<button class="reject-button">')
        .attr('data-url', row.for_url)
        .attr('data-filename', row.filename)
        .text("Reject"))
      .append('<div class="spacer"></div>')
      .append($('<button class="accept-button">')
        .attr('data-url', row.for_url)
        .attr('data-filename', row.filename)
        .text("Accept"))
      .append('<div class="spacer"></div>');
    $(entry)
      .append(heading)
      .append('<div class="line"></div>')
      .append(images)
      .append('<div class="line"></div>')
      .append(imageLabels)
      .append('<div class="line"></div>')
      .append(info)
      .append('<div class="line"></div>')
      .append(buttons);
    $.root().append(entry);
  }
  body += $.root().html();
  body += `</ul>
<script>
function makeButton(verb, url) {
  return async function button(e) {
    const button = e.target;
    await fetch(url, {
      method: verb,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: button.dataset.url,
        filename: button.dataset.filename,
      }),
      credentials: 'same-origin',
    });
    button.parentNode.parentNode.remove();
  }
}

function renderWidth(img) {
  const path = new URL(img.src).pathname;
  const sel = \`[data-img="\${path}"]\`;
  for (const label of document.querySelectorAll(sel)) {
    label.querySelector('.width').innerText = img.naturalWidth;
    label.querySelector('.height').innerText = img.naturalHeight;
  }
}

const acceptButton = makeButton('PUT', '/api/accept');
const rejectButton = makeButton('DELETE', '/api/reject');

for (const button of document.querySelectorAll('.accept-button')) {
  button.addEventListener('click', acceptButton)
}
for (const button of document.querySelectorAll('.reject-button')) {
  button.addEventListener('click', rejectButton)
}
for (const img of document.querySelectorAll('img')) {
  img.onload = () => renderWidth(img);
  renderWidth(img);
}
</script>
</body>
</html>`;
  res.send(body);
     } catch ( err) { console.log(err); res.sendStatus(500); }
});

app.get("/calibornstuck/:file", (req, res) => {
  res.sendFile(req.params.file, {
    root: ".data/storyfiles"
  });
});

const REDIRECTS = {
  // Homestuck title image
  "/assets/HS_logo-d428d19c5a20af8e0e84ec06a0a67ab6add95a595c18a2d412031d7615edc2c7.png":
    "https://cdn.glitch.com/439ce8bc-0439-41f9-9690-30909a6349d0%2Fhomestuck-title.gif?v=1572169366776",
  // Homepage June
  "/images/homepage/00001.gif":
    "https://cdn.glitch.com/439ce8bc-0439-41f9-9690-30909a6349d0%2Fhomepage-june.gif?v=1572169858862",
  // Homepage Rose
  "/images/homepage/00214.gif":
    "https://cdn.glitch.com/439ce8bc-0439-41f9-9690-30909a6349d0%2Fhomepage-rose.gif?v=1572169650785",
  // Homepage Dave
  "/images/homepage/00309.gif":
    "https://cdn.glitch.com/439ce8bc-0439-41f9-9690-30909a6349d0%2Fhomepage-dave.gif?v=1572170238065",
  "/images/homepage/00313.gif":
    "https://cdn.glitch.com/439ce8bc-0439-41f9-9690-30909a6349d0%2Fhomepage-dave.gif?v=1572170238065",
  // Homepage Jade
  "/images/homepage/00760.gif":
    "https://cdn.glitch.com/439ce8bc-0439-41f9-9690-30909a6349d0%2Fhomepage-jade.gif?v=1572170005980",
  "/stories": "/story"
};

const FILES = {
  "/info-story": "public/info-story.html",
  "/contacts": "public/contacts.html",
  "/info-shop": "public/info-shop.html",
  "/info-games": "public/info-games.html",
  "/news": "public/news.html",
  "/info-more": "public/info-more.html"
};

app.get("*", async (req, res) => {
  console.log("GET", req.path, "(Proxied)");
  const redirect = REDIRECTS[req.path];
  if (redirect) {
    console.log("Redirect", req.path, "to", redirect);
    return res.redirect(redirect);
  }

  const file = FILES[req.path];
  if (file) {
    console.log("Send", req.path, "to", file);
    return res.sendFile(file, { root: "." });
  }

  try {
    const url = new URL(req.path, "https://homestuck.com/");
    // @TODO: Cache homestuck pages
    const proxiedRequest = new fetch.Request(url, {
      accept: req.headers.accept,
      "user-agent": req.headers["user-agent"],
      "accept-language": req.headers["accept-language"],
      "accept-encoding": req.headers["accept-encoding"]
    });
    const proxiedResponse = await fetch(proxiedRequest);
    let body = await proxiedResponse.buffer();
    const ignoreHeaders = [
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "etag"
    ];
    for (const [k, v] of proxiedResponse.headers) {
      if (ignoreHeaders.includes(k)) {
        continue;
      }
      res.set(k, v);
    }

    if (proxiedResponse.headers.get("content-type").includes("text/html")) {
      body = await modify.page(body, req.path);
    }

    res.status(proxiedResponse.status).send(body);
  } catch (exception) {
    console.log("Failed:", exception);
  }
});

// listen for requests :)
var listener = app.listen(process.env.PORT, function() {
  console.log("Your app is listening on port " + listener.address().port);
});
