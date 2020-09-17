const http = require("https")
const fs = require("fs-extra")
const progress = require("cli-progress")
const xhr = require("xmlhttprequest").XMLHttpRequest
const XMLHttpRequest = new xhr()

const wait = (s) => {
    return new Promise(resolve => setTimeout(resolve, s * 1000))
}

exports.CreateDirectory = async function(path, options = {mode: 0o2775})
{
    try
    {
        await fs.ensureDir(path)
    }
    catch (err)
    {
        console.log(err)
    }
}

exports.GetFileSize = async function(url)
{
    var fileSize = ''
    XMLHttpRequest.open('HEAD', url, false)

    XMLHttpRequest.send(null)

    if (XMLHttpRequest.status === 200) {
        fileSize = XMLHttpRequest.getResponseHeader('content-length');
    }

    return fileSize;
}

exports.AttemptToDownloadImage = async function(url, path, limit)
{
    if (!url) {return}
    var result = 0
    var file = await fs.createWriteStream(path)  
    
    console.log("Attempting to get URL: " + url)

    try
    {

        var request = http.get(url, function(response)
        {
            response.pipe(file)
            var isDone = false

            file.on("finish", function()
            {
                isDone = true
                var bytes = file.bytesWritten/1048576
                
                console.log("Wrote file at " + path + " with size: " + Math.round(bytes * 100) / 100 + " megabytes")
		    })

            file.on("open", function()
            {
                console.log("Starting request for " + path)
            })

            file.on("ready", function()
            {
            })

	    }).on("error", function(error)
        {
            fs.unlink(path)
            console.log("Error trying to write file \"" + path + "\": " + error)
        })

        request.setTimeout(30000, function()
        {
            request.abort()
            console.log("Aborted since request timed out.")
		})
    }
    catch(error)
    {
      fs.unlink(path)
      console.log("An error was thrown trying to obtain URL: " + url + ": " + error)
      console.log("The directory will be devared.")

      result = 1
	}

    return result
}