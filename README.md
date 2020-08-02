# Treasure Extractor -- Booru by marnie
Extracts randomized images from Booru websites.

This program uses the [Booru API.](https://www.npmjs.com/package/booru)

##### Why?
I am too lazy to browse websites for images, so I'll use this bot.

### Requirements
- [node.js](https://nodejs.org/en/)

### Usage
To use this program is simple:
1. **Shift+Right Click** the program directory and do **"Open PowerShell Window Here"/"Open Command Prompt Here"** or use `cd [FILE DIRECTORY]`.
2. Run main.js:
  ```js
  node main.js
  ```
  
Ruuning this program will attempt to extract image or zipped files, it will create a directory inside `./batches/` where all the images are contained.
### Configuration
Inside the program is a [`settings.json`](/settings.json) file that governs the behavior of the program.

By default it should look like this:
```json
{
	"site": "danb",
	"tags": [
		"rating:explicit"
	],
	"amount": 50,
	"random": true,
	"organized": false,
	
	"allsite": false
}
```

You can edit this **json** file to change the behavior of the program.
##### Contents of [settings.json](/settings.json)
- site
  - the site where to get images.
    - anything not listed below will throw an error.
    - available aliases:
      - **danb**
      - **e621**
      - **e926**
      - **hypno**
      - **konac**
      - **yandere**
      - **gelb**
      - **r34**
      - **r34pa**
      - **derp**
      - **fur**
      - **real**
      - **xbo**
- tags
  - the tags used to search.
    - **WARNING!** Danbooru only allows 2 tags to be searched at the same time.
- amount
  - the amount of images to be searched.
    - **DISCLAIMER!** the program may not obtain the exact number of files.
- random
  - if the images are randomized.
- organized
  - if the images are seperated by directories containing a `contents.json` file, or inside the directory with a `sources.txt` file.
- allsite
  - if the program gets images from every site listed. This will ignore the "organized" option and will still write images from individual directories.
