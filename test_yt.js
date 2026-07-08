const youtubedl = require("youtube-dl-exec");

async function main() {
  try {
    const out = await youtubedl("https://www.youtube.com/watch?v=xX-N3B8ulnI", {
      dumpSingleJson: true,
      extractorArgs: "youtube:player_client=android",
      noCheckCertificates: true,
      noWarnings: true
    });
    console.log("Title:", out.title);
    console.log("Success with Android client");
  } catch (e) {
    console.error("Android client failed:", e.message?.slice(0, 300));
    
    try {
      const out = await youtubedl("https://www.youtube.com/watch?v=xX-N3B8ulnI", {
        dumpSingleJson: true,
        extractorArgs: "youtube:player_client=web",
        noCheckCertificates: true,
        noWarnings: true
      });
      console.log("Title:", out.title);
      console.log("Success with web client");
    } catch (e2) {
      console.error("Web client also failed:", e2.message?.slice(0, 300));
    }
  }
}

main().then(() => process.exit(0));
