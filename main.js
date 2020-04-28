// by marnie
const dir = require("./modules/directory")

const booru = require("booru")
const fs = require("fs-extra") 
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

const limit = options.amount
const random = options.random

async function Start() 
{
	if (Site)
	{
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
			for (success; success <= limit; success++)
			{
				let post = posts[success]

				if (post)
				{
					console.log("[" + success + "] Got: " + post.fileUrl)
				}
			}
		}
	}
	else
	{
		console.log("Malformed site name! Please see documentation.")
	}
}

Start()