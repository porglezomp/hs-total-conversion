const cheerio = require("cheerio");
const db = require("./dbhelpers");

const FILE_SIZE_LIMIT = 500000;
exports.FILE_SIZE_LIMIT = FILE_SIZE_LIMIT;
const FILE_SIZE_LIMIT_KB = (FILE_SIZE_LIMIT / 1000) | 0;

// @TODO: Can these be out-of-file?
const CALIBORNSTUCK_BUTTON_STYLE = `<style>
#calibornstuck-modal {
  left: 1em;
  right: 1em;
  top: 1em;
  bottom: 1em;
  position: fixed;
  max-width: 600px;
  min-width: 300px;
  background: white; color: black;
  border-radius: 4px;
  box-shadow: 1px 1px 32px rgba(0, 0, 0, 0.4);
  padding: 1em;
  margin: auto auto;
  z-index: 10000;
  opacity: 100%;
  transition: all 1s;
}

.hidden { display: none; opacity: 0%; }
.calibornstuck-img-wrapper { position: relative; }
a.calibornstuck-button { 
  position: absolute; left: 8px; top: 8px;
  background: rgba(255, 255, 255, 0.8);
  padding: 0.1em 1em;
  cursor: pointer;
  color: blue;
}
.credits {
  font-size: 10px;
  position: absolute; bottom: 8px; right: 8px;
  background: rgba(255, 255, 255, 0.8); padding: 0.1em 1em;
}

#calibornstuck-modal button { font-size: 16px; }
#calibornstuck-validation { color: red; }

.loader, .loader:after { border-radius: 50%; width: 2em; height: 2em; }
.loader {
  margin: 10px auto;
  font-size: 10px;
  position: relative;
  text-indent: -9999em;
  border: 0.5em solid rgba(0,36,255, 0.2);
  border-left-color: #0024ff;
  transform: translateZ(0);
  animation: load8 1.1s infinite linear;
}
@keyframes load8 { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
</style>`;

const CALIBORNSTUCK_MODAL = `
<div id="calibornstuck-modal" class="hidden">
  <p>
    Upload an image for the page. It should be <span id="image-width">650</span>x<span id="image-height">450</span>, in Caliborn's scribble style, and ideally saved as a GIF for size.
  </p><br>
  <p>
    Because these are all rough scribbles, the maximum file size is currently ${FILE_SIZE_LIMIT_KB}KB. If you've got a legitimate panel that's bigger, message @porglezomp on twitter and ask them about raising the file size limit.
  </p><br>
  <p>
    Your image must be manually approved before it appears on the site, so please be patient.
    If you include your contact info, I can follow up with you.
    If you include credit info, it will be displayed on the page if your image is accepted.
  </p><br>
  <p>
    Thanks for your contribution! &lt;3
  </p><br>
  <label for="upload-image">Upload an image:</label>
  <input type="file" id="upload-image" name="upload-image"><br><br>
  <label for="contact-info-input">Contact info. This is private. Any method you can be contacted by, if you want (optional):</label>
  <input type="text" id="contact-info-input" name="contact-info-input"><br>
  <label for="credits-info-input">Credit info. This is public. A name you want to show up on the page (optional):<label>
  <input type="text" id="credits-info-input" name="credits-info-input">
  <br>
  <p id="calibornstuck-validation"></p>
  <p id="calibornstuck-info"></p>
  <br>
  <button id="calibornstuck-cancel-button">Cancel</button>
  <button id="calibornstuck-submit-button">Submit image</button>
</div>
`;

// @TODO: Change to avoid too-modern features
const CALIBORNSTUCK_SCRIPT = `<script>
function validate(fileInput) {
  const file = fileInput.files[0];
  if (!file) {
    return false;
  }
  if (!file.type.startsWith('image/')) {
    return \`The file must be an image. Found file type \${file.type}\`;
  }
  if (file.size > ${FILE_SIZE_LIMIT}) {
    return \`File too big. It's \${(file.size/1000)|0}KB. Max allowed: ${FILE_SIZE_LIMIT_KB}KB.\`;
  }
  return true;
}

function delayMs(ms, value) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

async function getImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {  
      const image = new Image();
      image.onload = () => resolve(image);
      image.src = reader.result;
    }
    reader.readAsDataURL(file);
  });
}

async function modal(url, width, height) {
    const modal = document.getElementById('calibornstuck-modal');
    const fileInput = modal.querySelector('input[type=file]');
    const validationLabel = document.getElementById('calibornstuck-validation');
    const infoLabel = document.getElementById('calibornstuck-info');
    const cancelButton = document.getElementById('calibornstuck-cancel-button');
    const submitButton = document.getElementById('calibornstuck-submit-button');
    document.getElementById('image-width').innerText = width;
    document.getElementById('image-height').innerText = height;
    
    modal.classList.remove('hidden');
    fileInput.value = null;
    submitButton.disabled = true;
    
    fileInput.addEventListener('change', async evt => {
      const validation = validate(fileInput);
      validationLabel.innerText = '';
      if (validation == true) {
        submitButton.disabled = false;
        const image = await getImage(fileInput.files[0]);
        if (image.width != width || image.height != height) {
          validationLabel.innerText = \`Image dimensions don't match. Expected \${width}x\${height} but got \${image.naturalWidth}x\${image.naturalHeight}. Are you sure you want to submit?\`;
        }
      } else {
        if (validation) {
          validationLabel.innerText = validation;
        }
        submitButton.disabled = true;
      }
    })
    
    submitButton.addEventListener('click', async evt => {
      if (validate(fileInput) != true) {
        return;
      }

      infoLabel.innerText = '';
      validationLabel.innerText = '';

      const contactInfo = document.getElementById('contact-info-input');
      const creditsInfo = document.getElementById('credits-info-input');
      let data = new FormData();
      data.append('url', url);
      data.append('image', fileInput.files[0]);
      data.append('contact', contactInfo.value);
      data.append('credits', creditsInfo.value);
      data.append('pageUrl', location.pathname);
      infoLabel.innerHTML = '<div class="loader">Sending...</div>'
      const responsePromise = fetch('/api/upload-image', {
        method: 'POST',
        body: data,
      });

      // Show the spinner for at least half a second.
      const [response] = await Promise.all([responsePromise, delayMs(500)]);
      if (!response.ok) {
        infoLabel.innerText = '';
        validationLabel.innerText = \`There was an error submitting your image. Error \${response.status}\`;
        return;
      }

      infoLabel.innerText = "Upload succeeded";
      await delayMs(1500);
      fileInput.value = null;
      modal.classList.add('hidden');
      location.reload(true); // Force reload
    });

    cancelButton.addEventListener('click', evt => {
      fileInput.value = null;
      modal.classList.add('hidden');
    });
}

for (const button of document.querySelectorAll('.calibornstuck-button')) {
  const img = button.nextSibling;
  const text = button.innerText;
  const formatWidth = () => {
    if (img.naturalWidth != 0 && img.naturalHeight != 0) {
      button.innerText = text + \` (\${img.naturalWidth}x\${img.naturalHeight})\`;
    }
  };
  img.onload = formatWidth;
  formatWidth();
  button.addEventListener('click', async (e) => {
    await modal(img.src, img.naturalWidth, img.naturalHeight);
  });
}
</script>`;

async function modifyImage($, img) {
  if (img.attribs.src.startsWith("https://www.homestuck.com/")) {
    img.attribs.src = img.attribs.src.replace(
      /https:\/\/www.homestuck.com/,
      ""
    );
    const basePath = img.attribs.src;
    const row = await db.get(
      "SELECT * FROM Images WHERE for_url = ? AND accepted",
      basePath
    );
    $(img).wrap('<div class="calibornstuck-img-wrapper"></div>');
    if (row) {
      img.attribs.src = `/calibornstuck/${row.filename}`;
      $(img).after(`<div class="credits"></div>`);
      if (row.credits) {
        $(img.nextSibling).text(`image by ${row.credits}`);
      }
    } else {
      const row = await db.get(
        "SELECT COUNT(*) FROM Images WHERE for_url = ? AND NOT accepted AND NOT blocked",
        basePath
      );
      const count = row["COUNT(*)"];
      let message = "SUBMIT. AN IMAGE.";
      if (count == 1) {
        message = "(1 SUBMISSION. PENDING.)";
      } else if (count > 1) {
        message = `(${count} SUBMISSIONS. PENDING.)`;
      }
      $(img).before(`<a class="calibornstuck-button">${message}</a>`);
    }
  }
}

async function modifyCredits($) {
  const creditsContainer = $('div', $('h2')[0].parent)[0];
  $(creditsContainer).prepend('<br><h3>Original Homestuck Credits</h3><br>');
  const newCredits = $('<div class="type-bs pad-x-0 pad-x-lg--md" style="font-family:Verdana,Arial,Helvetica,sans-serif;font-weight:normal;"></div>');
  const rows = await db.all(`
SELECT * FROM Images
 WHERE accepted
 ORDER BY LENGTH(on_page), on_page
`);
  
  const contributors = await db.get(`
SELECT COUNT(DISTINCT credits) AS count FROM Images
`);
  
  $(newCredits).append(`<p>${rows.length} images from ${contributors.count} contributors</p><br>`);
  const pages = [];
  for (const row of rows) {
    if (pages.length == 0 || row.on_page != pages[pages.length-1].onPage) {
      const pageNumber = row.on_page.replace(/^\/?story\//, '');
      pages.push({
        pageNumber,
        onPage: row.on_page,
        images: row.credits.trim() ? new Set([row.credits]) : new Set(),
      });
    } else if (row.on_page == pages[pages.length-1].onPage) {
      if (row.credits.trim()) {
        pages[pages.length-1].images.add(row.credits);
      }
    }
  }
  
  for (const page of pages) {
    const entry = $('<p></p>');
    $(entry).append($("<a>").attr('href', page.onPage).text(`Page ${page.pageNumber}`));
    if (page.images.size) {
      $(entry).append(" - images by ").append($('<span>').text([...page.images].join(", ")));
    }
    $(newCredits).append(entry);
  }
  
  /*
  for (const row of rows) {
    const entry = $('<p></p>');
    const pageNumber = row.on_page.replace(/^\/?story\//, '');
    $(entry).append($("<a>").attr('href', row.on_page).text(`Page ${pageNumber}`));
    if (row.credits) {
      $(entry).append(" - by ").append($('<span>').text(row.credits));
    }
    $(newCredits).append(entry);
  }
  */
  $(creditsContainer).prepend(newCredits);
  $(creditsContainer).prepend('<h3>Calibornstuck Credits</h3><br>');
}

async function modifyPage(body, path) {
  $ = cheerio.load(body);
  const newTitle = $("title")
    .text()
    .replace(/Homestuck/g, "Calibornstuck")
    .replace(/Official/g, "")
    .replace(/Andrew Hussie/gi, "Caliborn");
  $("title").text(newTitle);

  $("head").append(CALIBORNSTUCK_BUTTON_STYLE);
  $("body").append(CALIBORNSTUCK_MODAL);
  $("body").append(CALIBORNSTUCK_SCRIPT);
  if (path == '/credits/art') {
    await modifyCredits($);
  }
  const copyrightSpan =$('span:contains("©")')[0]; 
  if (copyrightSpan) {
    const copyrightDiv = copyrightSpan.parent;
    if (copyrightDiv) {
      $(copyrightDiv).prepend("Homestuck ")
        .append("<br>Calibornstuck © 2019 by its contributors");
    }
  }
  const jobs = [];
  $("img").each((i, img) => {
    jobs.push(modifyImage($, img));
  });
  await Promise.all(jobs);
  return $.root().html();
}

exports.page = modifyPage;