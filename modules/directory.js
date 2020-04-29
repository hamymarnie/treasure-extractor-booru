const http = require("https")
const fs = require("fs-extra")

exports.CreateDirectory = async function(path, options = {mode: 0o2775})
{
    try
    {
        await fs.ensureDir(path)
        console.log("File does exist or is already created.")
    }
    catch (err)
    {
        console.log(err)
    }
}

exports.AttemptToDownloadImage = async function(url, path)
{
    if (!url) {return}
    let result = 0
    let file = fs.createWriteStream(path)  
    
    console.log("Attempting to get URL: " + url)
    try
    {
        let request = http.get(url, function(response)
        {
            response.pipe(file)
            file.on("finish", function()
            {
                console.log("Wrote file at " + path + " with size: " + file.bytesWritten/1048576 + " megabytes")
		    })
	    }).on("error", function(error)
        {
            fs.unlink(path)
            console.log("Error trying to write file \"" + path + "\": " + error)
        })

        request.setTimeout(15000, function()
        {
            request.abort()
            console.log("Aborted since request exceeded 15 seconds.")
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