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
    let result = 0
    let file = fs.createWriteStream(path)  
    
    console.log("Attempting to get URL: " + url)/*
    const bar = new progress.SingleBar({
        stopOnComplete: true,
        format: "Writing... [{bar}] | {percentage} | ETA: {eta}s | {value}/{total}"
    }, progress.Presets.shades_classic)*/

    try
    {
        /*
        var fileSize = this.GetFileSize(url)
        bar.start(fileSize || 0, 0, {
            speed: "Undefined"
        })*/

        let request = http.get(url, function(response)
        {
            response.pipe(file)
            let isDone = false

            file.on("finish", function()
            {
                isDone = true
                let bytes = file.bytesWritten/1048576
                
                console.log("Wrote file at " + path + " with size: " + Math.round(bytes * 100) / 100 + " megabytes")
                //bar.stop()
		    })

            file.on("open", function()
            {
                console.log("Starting request for " + path)
            })
            /*
            file.on("ready", function()
            {
                let LastWritten = file.bytesWritten
                while (isDone == false) 
                {
                    bar.update(file.bytesWritten - LastWritten)

                    LastWritten = file.bytesWritten
                    wait(1/30)
                }   
            })*/
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
      console.log("The directory will be deleted.")

      result = 1
	}

    return result
}