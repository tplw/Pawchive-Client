cask "pawchive" do
  version "1.0.5"
  sha256 "60774467ca36991f957af80397d424114062508d8a17284ab1e591b983a303ec"

  url "https://github.com/tplw/Pawchive-Client/releases/download/v#{version}/Pawchive_#{version}_universal.dmg"
  name "Pawchive"
  desc "Native client for the Pawchive archive"
  homepage "https://github.com/tplw/Pawchive-Client"

  livecheck do
    url "https://github.com/tplw/Pawchive-Client/releases/latest"
    strategy :github_latest
  end

  depends_on macos: :big_sur

  app "Pawchive.app"

  zap trash: [
    "~/Library/Application Support/pw.pawchive.client",
    "~/Library/Caches/pw.pawchive.client",
    "~/Library/Saved Application State/pw.pawchive.client.savedState",
    "~/Library/WebKit/pw.pawchive.client",
  ]
end
