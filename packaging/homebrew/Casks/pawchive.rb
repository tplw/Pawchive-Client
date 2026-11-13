cask "pawchive" do
  version "1.0.6"
  sha256 "73baf128beb957b4095f3482e8e96b12fcb839df6dc7bf4fb4a7612bef270266"

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
