const fs = require("fs-extra")
const axios = require("axios")

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
    axios({
        url,
        responseType: 'stream'
    }).then(
        response =>
              new Promise((resolve, reject) => {
                response.data
                  .pipe(fs.createWriteStream(image_path))
                  .on('finish', () => resolve())
                  .on('error', e => reject(e));
              }),
    )
}