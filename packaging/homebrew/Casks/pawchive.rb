cask "pawchive" do
  version "1.0.6.1"
  sha256 "f1662ec7ea562f02bfa5099d4d351879b92013b93d2c8c85a7f9af50a93c7b5c"

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
