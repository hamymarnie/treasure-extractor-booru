// by marnie
const dir = require("./modules/directory")

const booru = require("booru")
const fs = require("fs-extra") 
const base = require("path")
//
console.log("Starting Treasure-Extractor by marnie...")
console.log("Reading settings.json...")
const options = require('./settings.json')

// declare all boorus
console.log("Declaring all booru websites...")
const boorus = {
    "danb": booru.forSite('danbooru'),   
    "e621": booru.forSite('e6'),
    "e926": booru.forSite('e9'),
    "hypno": booru.forSite('hypnohub'),
    "konac": booru.forSite('konac'),
    "yandere": booru.forSite('yandere'),
    "gelb": booru.forSite('gelbooru'),
    "r34": booru.forSite('rule34'),
    "loli": booru.forSite('lolibooru'),
    "r34pa": booru.forSite('pa'),
    "derp": booru.forSite('derpibooru'),
    "fur": booru.forSite('fb'),
    "real": booru.forSite('realbooru'),
    "xbo": booru.forSite('xb')
}

// Ensure if batches directory exists
dir.CreateDirectory("./batches")

// Creating a batch with tick name...
console.log("Creating directory batch...")

let DesiredName = "[batch] ID " + Date.now()

const path = "./batches/" + DesiredName
dir.CreateDirectory(path)

const Site = boorus[options.site]
const tags = options.tags.concat()

async function Start(limit = options.amount, random = options.random) 
{
	if (Site)
	{
		var urls = []
		var success = 0
		var posts = null

		try
		{
			posts = await Site.search(tags, {limit, random})
		}
		catch (error)
		{
			console.log("An error was thrown trying to obtain posts: " + error)
			return
		}

		if (posts)
		{
			if (options.organized == false)
			{
				var txtPath = path + "/sources.txt"
				var file = await fs.createWriteStream(txtPath, "utf8")
			
				fs.outputFile(txtPath, "Sources for " + DesiredName + "\n-------------------------------------------------------\n")				
				console.log("Created sources.txt for batch")
			}

			for (success; success <= limit; success++)
			{
				let post = posts[success]

				if (post)
				{
					if (typeof post.fileUrl == "string")
					{
						if (options.organized == true)
						{
							var dirPath = path + "/" + success
							dir.CreateDirectory(dirPath)
							console.log("Wrote directory: " + dirPath)
						}
						else
						{
							var iPath = path + "/images"
							dir.CreateDirectory(iPath)
						}

						let thePath = options.organized == true && dirPath || iPath

						try
						{
							var result = await dir.AttemptToDownloadImage(post.fileUrl, thePath + "/" + success + " - " + base.basename(post.fileUrl), limit)
							if (result == 1)
							{
								console.log("Error trying to get file from " + post.fileUrl + " for index " + success + ": The directory will remain empty.")
							}
						}
						catch (err)
						{
							console.log("Error trying to get file from " + post.fileUrl + " for index " + success + ": " + err)
						}

						if (options.organized == true) 
						{
							await fs.ensureFile(dirPath + "/content.json")
							.then(() => 
							{
								let jsonContents = {
									fileUrl: post.fileUrl,
									tags: post.tags,
									id: post.id,
									score: post.score,
									source: post.source,
									rating: post.rating
								}

								fs.writeFile(dirPath + "/content.json", JSON.stringify(jsonContents, null, "\t"))
								console.log("Wrote information for " + success + " at its own content.json")
							})
						}
						else	
						{
							fs.appendFile(txtPath, "\n [" + success + "] ~ URL: " + post.fileUrl)
							console.log("Appending source for: " + success)
						}
					}
					else
					{
						console.log("Index " + success + " is not a valid file, ignoring...")
					}
				}
			}

			console.log("Done. Images written: " + success)
		}
	}
	else
	{
		console.log("Malformed site name! Please see documentation.")
	}
}

Start()