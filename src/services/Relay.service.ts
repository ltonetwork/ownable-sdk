import { EventChain, LTO, Message, Relay } from "@ltonetwork/lto";
import axios from "axios";
import sendFile from "./relayhelper.service";
import JSZip from "jszip";
import mime from "mime/lite";
import { MessageExt, MessageInfo } from "../interfaces/MessageInfo";
import { sign } from "@ltonetwork/http-message-signatures";
import LTOService from "./LTO.service";

export const lto = new LTO(process.env.REACT_APP_LTO_NETWORK_ID);

export class RelayService {
  static relayURL = process.env.REACT_APP_RELAY || process.env.REACT_APP_LOCAL;
  private static relay = new Relay(`${this.relayURL}`);

  /**
   * Handle All Signed Requests
   */
  static async handleSignedRequest(
    method: string,
    url: string,
    options: { headers?: Record<string, string> } = {}
  ) {
    try {
      const sender = LTOService.account;
      const request = {
        headers: {
          ...options.headers, // Include optional headers in the request
        },
        method,
        url,
      };

      const signedRequest = await sign(request, { signer: sender });

      const response = await axios({
        method: signedRequest.method,
        url: signedRequest.url,
        headers: {
          ...signedRequest.headers,
          ...options.headers, // Ensure optional headers are included after signing
        },
        validateStatus: (status) => {
          return (status >= 200 && status < 300) || status === 304;
        },
      });

      return response;
    } catch (error) {
      console.error("Error in handleSignedRequest:", error);
      throw error;
    }
  }

  /**
   * Send ownable to a recipient.
   */
  static async sendOwnable(recipient: string, content?: Uint8Array) {
    const sender = LTOService.account;

    if (!recipient) {
      console.error("Recipient not provided");
      return;
    }

    try {
      if (sender) {
        const messageHash = await sendFile(
          this.relay,
          content,
          sender,
          recipient
        );
        return messageHash;
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }

  /**
   * Return just message hashes
   */
  static async readInboxHashes() {
    const sender = LTOService.account;
    if (!sender) {
      console.error("Account not initialized");
      return [];
    }

    const address = sender.address;
    const isRelayAvailable = await this.isRelayUp();
    if (!isRelayAvailable) return [];

    const url = `${this.relayURL}/inboxes/${address}/`;

    try {
      const responses = await this.handleSignedRequest("GET", url);

      if (!responses || !responses.data || responses.data.length === 0) {
        return [];
      }

      const serverHashes = await Promise.all(
        responses.data.map(async (response: MessageInfo) => {
          const messageUrl = `${this.relayURL}/inboxes/${address}/${response.hash}`;
          const infoResponse = await this.handleSignedRequest(
            "GET",
            messageUrl
          );

          if (infoResponse && infoResponse.data && infoResponse.data.hash) {
            return infoResponse.data.hash;
          } else {
            console.warn(
              "Failed to retrieve message hash for response:",
              response
            );
            return null;
          }
        })
      );

      return serverHashes.filter(Boolean);
    } catch (error) {
      console.error("Failed to read relay data:", error);
      return [];
    }
  }

  /**
   * Read relay data for the current sender.
   */
  static async readRelayData() {
    const sender = LTOService.account;
    if (!sender) {
      console.error("Account not initialized");
      return null;
    }

    const address = sender.address;
    const isRelayAvailable = await this.isRelayUp();
    if (!isRelayAvailable) return null;

    const url = `${this.relayURL}/inboxes/${address}/list`;

    try {
      const responses = await this.handleSignedRequest("GET", url);

      if (!responses.data.metadata.length) return null;

      const ownableData = await Promise.all(
        responses.data.metadata.map(async (response: MessageInfo) => {
          if (!response.hash) {
            console.warn("Skipping response without a hash:", response);
            return null;
          }

          const messageUrl = `${this.relayURL}/inboxes/${address}/${response.hash}`;
          try {
            const infoResponse = await this.handleSignedRequest(
              "GET",
              messageUrl
            );

            if (!infoResponse.data.sender) {
              console.warn("Skipping response without a sender:", infoResponse);
              return null;
            }

            const message = Message.from(infoResponse.data);

            return { message, messageHash: infoResponse.data.hash };
          } catch (error) {
            console.error(
              `Failed to process message with hash ${response.hash}:`,
              error
            );
            return null;
          }
        })
      );
      return ownableData.filter((data) => data !== null);
    } catch (error) {
      console.error("Failed to read relay data:", error);
      return null;
    }
  }

  /**
   * Remove an ownable by its hash.
   */
  static async removeOwnable(hash: string): Promise<string> {
    const sender = LTOService.account;
    if (!sender) {
      throw new Error("Sender not initialized");
    }

    const address = sender.address;
    const url = `${this.relayURL}/inboxes/${address}/${hash}`;

    try {
      const response = await this.handleSignedRequest("DELETE", url);

      if (response?.status === 204) {
        return "Successfully cleared ownable";
      } else {
        throw new Error(`${response}`);
      }
    } catch (error) {
      console.error("Failed to remove ownable:", error);
      throw new Error("Failed to clear: " + error);
    }
  }

  /**
   * Check if relay service is up.
   */
  static async isRelayUp(): Promise<boolean> {
    if (!this.relayURL) return false;
    try {
      const response = await this.handleSignedRequest("HEAD", this.relayURL);
      if (response.status === 200) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Relay service is down:", error);
      return false;
    }
  }

  /**
   * Extract assets from a zip file.
   */
  static async extractAssets(zipFile: File | JSZip): Promise<File[]> {
    const zip =
      zipFile instanceof JSZip ? zipFile : await JSZip.loadAsync(zipFile);
    const assetFiles = await Promise.all(
      Object.entries(zip.files)
        .filter(([filename]) => !filename.startsWith("."))
        .map(async ([filename, file]) => {
          const blob = await file.async("blob");
          const type = mime.getType(filename) || "application/octet-stream";
          return new File([blob], filename, { type });
        })
    );
    return assetFiles;
  }

  /**
   * Get chain.json from a list of files.
   */
  private static async getChainJson(
    filename: string,
    files: File[]
  ): Promise<EventChain> {
    const file = files.find((f) => f.name === filename);
    if (!file) throw new Error(`Invalid package: missing ${filename}`);
    return JSON.parse(await file.text());
  }

  /**
   * Check and return unique messages, avoiding duplicates.
   */
  static async checkDuplicateMessage(messages: MessageExt[]) {
    const uniqueItems = new Map<
      string,
      { message: Message; eventsLength: number; messageHash: string }
    >();

    for (const messageExt of messages) {
      const { message, messageHash } = messageExt;

      if (!message || !messageHash) {
        console.error("Message or messageHash is missing.");
        continue;
      }

      const data = message.data;
      if (!data) {
        console.error("Message data is missing.");
        continue;
      }

      const assets = await this.extractAssets(data.buffer);
      const chain = await this.getChainJson("chain.json", assets);

      const currentLength = uniqueItems.get(chain.id)?.eventsLength || 0;
      if (chain.events.length > currentLength) {
        uniqueItems.set(chain.id, {
          message,
          eventsLength: chain.events.length,
          messageHash,
        });
      }
    }

    return Array.from(uniqueItems.values()).map(({ message, messageHash }) => ({
      message,
      messageHash,
    }));
  }
}
