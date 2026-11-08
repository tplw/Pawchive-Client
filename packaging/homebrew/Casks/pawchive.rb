cask "pawchive" do
  version "1.0.5"
  sha256 "e52474e981baa9fffff9cf8fb265af3c2d7042f93bede67858c0b1409dc50c64"

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
