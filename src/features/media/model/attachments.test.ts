import { describe, expect, it } from "vitest";
import type { DownloadRecord, PlaylistItem } from "../../../shared/types";
import {
  attachmentFromDownload,
  attachmentFromPlaylistItem,
  queueItemFromDownload,
} from "./attachments";
import { queueItemFromAttachment } from "../../player/model/queue";

const playlistItem: PlaylistItem = {
  id: 1,
  playlistId: 2,
  service: "patreon",
  creatorId: "creator",
  postId: "post",
  mediaPath: "aa/bb/cover.png",
  mediaUrl: "https://pawchive.pw/data/aa/bb/cover.png",
  title: "Cover",
  creatorName: "Artist",
  thumbnailUrl: null,
  mediaKind: "image",
  addedAt: 0,
  localPath: null,
};

const download: DownloadRecord = {
  id: "dl",
  url: "https://pawchive.pw/data/aa/bb/clip.mp4",
  filePath: "/tmp/clip.mp4",
  fileName: "clip.mp4",
  mediaKind: "video",
  title: "Clip",
  creatorName: "Artist",
  service: "patreon",
  creatorId: "creator",
  postId: "post",
  playlistId: null,
  thumbnailUrl: null,
  totalBytes: 10,
  downloadedBytes: 10,
  status: "completed",
  error: null,
  createdAt: 0,
  updatedAt: 0,
};

describe("media attachments", () => {
  it("converts a playlist item using the displayed URL", () => {
    const attachment = attachmentFromPlaylistItem(
      playlistItem,
      "http://127.0.0.1/media/token",
    );
    expect(attachment).toMatchObject({
      name: "Cover",
      path: "aa/bb/cover.png",
      url: "http://127.0.0.1/media/token",
      kind: "image",
      provider: "external",
      ext: "png",
      previewOnly: false,
    });
  });

  it("keeps the full media URL when a download has no local URL yet", () => {
    const imageDownload: DownloadRecord = {
      ...download,
      url: "https://file.pawchive.pw/data/aa/bb/page.png",
      thumbnailUrl: "https://img.pawchive.pw/thumbnail/data/aa/bb/page.png",
      mediaKind: "image",
    };

    const attachment = attachmentFromDownload(imageDownload, null);

    expect(attachment.url).toBe(imageDownload.url);
    expect(attachment.thumbnailUrl).toBe(imageDownload.thumbnailUrl);
  });

  it("converts a download into an image attachment and queue item", () => {
    const attachment = attachmentFromDownload(download, download.filePath);
    expect(attachment).toMatchObject({
      name: "Clip",
      path: "/tmp/clip.mp4",
      kind: "image",
      provider: "pawchive",
      ext: "mp4",
    });
    expect(queueItemFromDownload(download)).toMatchObject({
      id: "dl",
      localPath: "/tmp/clip.mp4",
      filePath: "/tmp/clip.mp4",
      fileName: "clip.mp4",
      mediaKind: "video",
      title: "Clip",
      creatorName: "Artist",
      service: "patreon",
      creatorId: "creator",
      postId: "post",
    });
  });

  it("keeps a downloaded local path on a post queue item", () => {
    const item = queueItemFromAttachment(
      {
        name: "clip.mp4",
        path: "/aa/bb/clip.mp4",
        url: "https://file.pawchive.pw/data/aa/bb/clip.mp4",
        downloadUrl: "https://file.pawchive.pw/data/aa/bb/clip.mp4",
        thumbnailUrl: null,
        kind: "video",
        provider: "pawchive",
        ext: "mp4",
        previewOnly: false,
        localPath: "/tmp/Downloads/Ada/clip.mp4",
      },
      {
        title: "Clip",
        creatorName: "Ada",
        artwork: null,
        service: "patreon",
        creatorId: "creator",
        postId: "post",
      },
    );

    expect(item.localPath).toBe("/tmp/Downloads/Ada/clip.mp4");
  });
});
