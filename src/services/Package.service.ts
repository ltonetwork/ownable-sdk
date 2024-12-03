import LocalStorageService from "./LocalStorage.service";
import {
  TypedPackageCapabilities,
  TypedPackage,
  TypedPackageStub,
} from "../interfaces/TypedPackage";
import JSZip from "jszip";
import mime from "mime/lite";
import IDBService from "./IDB.service";
import calculateCid from "../utils/calculateCid";
import { TypedCosmWasmMsg } from "../interfaces/TypedCosmWasmMsg";
import TypedDict from "../interfaces/TypedDict";
import { RelayService } from "./Relay.service";
import { Buffer } from "buffer";
import { EventChain } from "@ltonetwork/lto";
import OwnableService from "./Ownable.service";
import { MessageExt } from "../interfaces/MessageInfo";

const exampleUrl = process.env.REACT_APP_OWNABLE_EXAMPLES_URL;
const examples: TypedPackageStub[] = exampleUrl
  ? [
      {
        title: "Antenna",
        name: "ownable-antenna",
        description: "Add-on for Robot",
        stub: true,
      },
      {
        title: "Armor",
        name: "ownable-armor",
        description: "Add-on for Robot",
        stub: true,
      },
      {
        title: "Car",
        name: "ownable-car",
        description: "Ride for HODLers",
        stub: true,
      },
      {
        title: "Paint",
        name: "ownable-paint",
        description: "Consumable for Robot",
        stub: true,
      },
      {
        title: "Potion",
        name: "ownable-potion",
        description: "Drink a colorful potion",
        stub: true,
      },
      {
        title: "Robot",
        name: "ownable-robot",
        description: "An adorable robot companion",
        stub: true,
      },
      {
        title: "Speakers",
        name: "ownable-speakers",
        description: "Add-on for Robot",
        stub: true,
      },
    ]
  : [];
export const HAS_EXAMPLES = exampleUrl !== "";

const capabilitiesStaticOwnable = {
  isDynamic: false,
  hasMetadata: false,
  hasWidgetState: false,
  isConsumable: false,
  isConsumer: false,
  isTransferable: false,
  isBridgeable: false,
};

export default class PackageService {
  static list(): Array<TypedPackage | TypedPackageStub> {
    const local = (LocalStorageService.get("packages") || []) as TypedPackage[];
    for (const pkg of local) {
      pkg.versions = pkg.versions.map(({ date, cid }) => ({
        date: new Date(date),
        cid,
      }));
    }

    const set = new Map(
      [...examples, ...local].map((pkg) => [pkg.name, pkg])
    ).values();

    return Array.from(set).sort((a, b) => (a.title >= b.title ? 1 : -1));
  }

  static info(nameOrCid: string, uniqueMessageHash?: string): TypedPackage {
    const packages = (LocalStorageService.get("packages") ||
      []) as TypedPackage[];

    const found = packages.find(
      (pkg) =>
        (pkg.name === nameOrCid ||
          pkg.versions.some((v) => v.cid === nameOrCid)) &&
        (!uniqueMessageHash ||
          pkg.versions.some((v) => v.uniqueMessageHash === uniqueMessageHash))
    );

    if (!found) throw new Error(`Package not found: ${nameOrCid}`);
    return found;
  }

  // private static storePackageInfo(
  //   title: string,
  //   name: string,
  //   description: string | undefined,
  //   cid: string,
  //   keywords: string[],
  //   capabilities: TypedPackageCapabilities,
  //   isNotLocal?: boolean,
  //   uniqueMessageHash?: string
  // ): TypedPackage {
  //   const packages = (LocalStorageService.get("packages") ||
  //     []) as TypedPackage[];
  //   let pkg = packages.find((pkg) => pkg.name === name);

  //   if (!pkg) {
  //     pkg = {
  //       title,
  //       name,
  //       description,
  //       cid,
  //       keywords,
  //       isNotLocal,
  //       ...capabilities,
  //       uniqueMessageHash,
  //       versions: [],
  //     };
  //     packages.push(pkg);
  //   } else {
  //     Object.assign(pkg, {
  //       cid,
  //       description,
  //       keywords,
  //       uniqueMessageHash,
  //       ...capabilities,
  //     });
  //   }

  //   pkg.versions.push({ date: new Date(), cid });
  //   LocalStorageService.set("packages", packages);

  //   return pkg;
  // }

  private static storePackageInfo(
    title: string,
    name: string,
    description: string | undefined,
    cid: string,
    keywords: string[],
    capabilities: TypedPackageCapabilities,
    isNotLocal?: boolean,
    uniqueMessageHash?: string
  ): TypedPackage {
    const packages = (LocalStorageService.get("packages") ||
      []) as TypedPackage[];

    // Locate the package with matching cid and uniqueMessageHash
    let pkg = packages.find(
      (pkg) =>
        pkg.name === name &&
        pkg.cid === cid &&
        pkg.uniqueMessageHash === uniqueMessageHash
    );

    if (!pkg) {
      // Create new package entry if not found
      pkg = {
        title,
        name,
        description,
        cid,
        keywords,
        isNotLocal,
        ...capabilities,
        uniqueMessageHash,
        versions: [{ date: new Date(), cid, uniqueMessageHash }],
      };
      packages.push(pkg);
    } else {
      // Update package and add new version info if it's an update
      Object.assign(pkg, {
        description,
        keywords,
        uniqueMessageHash,
        ...capabilities,
      });
      pkg.versions.push({ date: new Date(), cid, uniqueMessageHash });
    }

    // Save all packages back to LocalStorage under the single "packages" key
    LocalStorageService.set("packages", packages);

    return pkg;
  }

  static async extractAssets(zipFile: File, chain?: boolean): Promise<File[]> {
    const zip = await JSZip.loadAsync(zipFile);

    if (chain) {
      const chainFiles = await Promise.all(
        Array.from(Object.entries(zip.files))
          .filter(([filename]) => !filename.startsWith("."))
          .map(async ([filename, file]) => {
            const blob = await file.async("blob");
            const type = mime.getType(filename) || "application/octet-stream";
            return new File([blob], filename, { type });
          })
      );
      return chainFiles;
    }

    const assetFiles = await Promise.all(
      Array.from(Object.entries(zip.files))
        .filter(
          ([filename]) => !filename.startsWith(".") && filename !== "chain.json"
        )
        .map(async ([filename, file]) => {
          const blob = await file.async("blob");
          const type = mime.getType(filename) || "application/octet-stream";
          return new File([blob], filename, { type });
        })
    );
    return assetFiles;
  }

  private static async storeAssets(cid: string, files: File[]): Promise<void> {
    if (!(await IDBService.hasStore(`package:${cid}`))) {
      await IDBService.createStore(`package:${cid}`);
    }

    await IDBService.setAll(
      `package:${cid}`,
      Object.fromEntries(files.map((file) => [file.name, file]))
    );
  }

  private static async storeMessageHash(messageHash: string) {
    const key = "messageHashes";
    LocalStorageService.append(key, messageHash);
  }

  static stringToBuffer(str: string): Buffer {
    return Buffer.from(str, "utf8");
  }

  static base64ToBuffer(base64: string): Buffer {
    return Buffer.from(base64, "base64");
  }

  static bufferToString(buffer: Buffer): string {
    return buffer.toString("utf8");
  }

  static async getChainJson(filename: string, files: any): Promise<any> {
    const extractedFile = await this.extractAssets(files, true);
    const file = extractedFile.find((file) => file.name === filename);
    if (!file) throw new Error(`Invalid package: missing ${filename}`);

    const fileContent = await file.text();
    const json = JSON.parse(fileContent);

    json.events = json.events.map((event: MessageExt) => {
      //event.previous = this.stringToBuffer(event.previous);
      //event.signature = this.stringToBuffer(event.signature);
      //event.hash = this.stringToBuffer(event.hash);
      //event.signKey.publicKey = this.stringToBuffer(event.signKey.publicKey);
      if (event.data.startsWith("base64:")) {
        const base64Data = event.data.slice(7);
        const bufferData = this.base64ToBuffer(base64Data);
        const data = JSON.parse(this.bufferToString(bufferData));
        event.parsedData = data;
      }
      return event;
    });

    return json;
  }

  private static async getPackageJson(
    filename: string,
    files: File[]
  ): Promise<any> {
    const file = files.find((file) => file.name === filename);
    if (!file) throw new Error(`Invalid package: missing ${filename}`);
    return JSON.parse(await file.text());
  }

  private static async getCapabilities(
    files: File[]
  ): Promise<TypedPackageCapabilities> {
    if (files.findIndex((file) => file.name === "package.json") < 0)
      throw new Error("Invalid package: missing package.json");

    if (files.findIndex((file) => file.name === "ownable_bg.wasm") < 0)
      return capabilitiesStaticOwnable;

    const query: TypedCosmWasmMsg = await this.getPackageJson(
      "query_msg.json",
      files
    );
    const execute: TypedCosmWasmMsg = await this.getPackageJson(
      "execute_msg.json",
      files
    );

    const hasMethod = (schema: TypedCosmWasmMsg, find: string) =>
      schema.oneOf.findIndex((method) => method.required.includes(find)) >= 0;

    if (!hasMethod(query, "get_info"))
      throw new Error("Invalid package: missing `get_info` query method");

    return {
      isDynamic: true,
      hasMetadata: hasMethod(query, "get_metadata"),
      hasWidgetState: hasMethod(query, "get_widget_state"),
      isConsumable: hasMethod(execute, "consume"),
      isConsumer: hasMethod(query, "is_consumer_of"),
      isTransferable: hasMethod(execute, "transfer"),
    };
  }

  static async import(zipFile: File): Promise<TypedPackage> {
    const files = await this.extractAssets(zipFile);
    const packageJson: TypedDict = await this.getPackageJson(
      "package.json",
      files
    );
    const name: string = packageJson.name || zipFile.name.replace(/\.\w+$/, "");
    const title = name
      .replace(/^ownable-|-ownable$/, "")
      .replace(/[-_]+/, " ")
      .replace(/\b\w/, (c) => c.toUpperCase());
    const description: string | undefined = packageJson.description;
    const cid = await calculateCid(files);
    const capabilities = await this.getCapabilities(files);
    const keywords: string[] = packageJson.keywords || "";

    await this.storeAssets(cid, files);
    return this.storePackageInfo(
      title,
      name,
      description,
      cid,
      keywords,
      capabilities
    );
  }

  static async importFromRelay() {
    try {
      const relayData = await RelayService.readRelayData();

      if (!relayData || !Array.isArray(relayData) || relayData.length === 0) {
        return null;
      }

      const filteredMessages = await RelayService.checkDuplicateMessage(
        relayData
      );

      let triggerRefresh = false;

      const results = await Promise.all(
        filteredMessages.map(async (data: any) => {
          try {
            const { message, ...messageHash } = data;
            const mainMessage = message;
            const asset = await this.extractAssets(mainMessage.data.buffer);
            if (asset.length === 0) return null;

            const cid = await calculateCid(asset);
            const chainJson = await this.getChainJson(
              "chain.json",
              mainMessage.data.buffer
            );

            if (await IDBService.hasStore(`package:${cid}`)) {
              if (await this.isCurrentEvent(chainJson)) {
                this.removeOlderPackage(chainJson.id);
              } else {
                return null;
              }
            }

            const packageJson = await this.getPackageJson(
              "package.json",
              asset
            );
            const name = packageJson.name;
            const title = name
              .replace(/^ownable-|-ownable$/, "")
              .replace(/[-_]+/, " ")
              .replace(/\b\w/, (c: any) => c.toUpperCase());
            const description = packageJson.description;
            const capabilities = await this.getCapabilities(asset);
            const keywords: string[] = packageJson.keywords || "";
            const isNotLocal = true;
            const { ...values } = messageHash;
            const uniqueMessageHash = values.messageHash;

            if (await IDBService.hasStore(`package:${cid}`)) {
              triggerRefresh = true;
            }

            await this.storeMessageHash(uniqueMessageHash);
            await this.storeAssets(cid, asset);

            const pkg = this.storePackageInfo(
              title,
              name,
              description,
              cid,
              keywords,
              capabilities,
              isNotLocal,
              uniqueMessageHash
            );

            const chain = EventChain.from(chainJson);
            pkg.chain = chain;
            pkg.uniqueMessageHash = uniqueMessageHash;

            return pkg;
          } catch (err) {
            console.error("Error processing data:", err);
            return null; // Skip failed items
          }
        })
      );

      const packages = results.filter((pkg) => pkg !== null);

      return [packages, triggerRefresh];
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  }

  static async isCurrentEvent(chainJson: EventChain) {
    let existingChain;
    if (await IDBService.hasStore(`ownable:${chainJson.id}`)) {
      existingChain = await IDBService.get(`ownable:${chainJson.id}`, "chain");
    }

    if (existingChain === undefined || existingChain.events === undefined) {
      return true;
    }
    if (existingChain.events?.length) {
      if (chainJson.events.length > existingChain.events.length) {
        return true;
      }
    } else {
      return false;
    }
  }

  static async removeOlderPackage(id: string) {
    await OwnableService.delete(id);
  }

  static async downloadExample(key: string): Promise<TypedPackage> {
    if (!exampleUrl)
      throw new Error("Unable to download example ownable: URL not configured");

    const filename = key.replace(/^ownable-/, "") + ".zip";

    const response = await fetch(`${exampleUrl}/${filename}`);
    if (!response.ok)
      throw new Error(
        `Failed to download example ownable: ${response.statusText}`
      );
    if (response.headers.get("Content-Type") !== "application/zip")
      throw new Error(
        "Failed to download example ownable: invalid content type"
      );

    const zipFile = new File([await response.blob()], `${key}.zip`, {
      type: "application/zip",
    });

    return this.import(zipFile);
  }

  static async getAsset(
    cid: string,
    name: string,
    read: (fr: FileReader, contents: Blob | File) => void
  ): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      IDBService.get(`package:${cid}`, name).then(
        (mediaFile: File) => {
          if (!mediaFile) {
            reject(`Asset "${name}" is not in package ${cid}`);
          }

          fileReader.onload = (event) => {
            resolve(event.target?.result!);
          };

          read(fileReader, mediaFile);
        },
        (error) => reject(error)
      );
    });
  }

  static getAssetAsText(cid: string, name: string): Promise<string> {
    const read = (fr: FileReader, mediaFile: Blob | File) =>
      fr.readAsText(mediaFile);
    return this.getAsset(cid, name, read) as Promise<string>;
  }

  static getAssetAsDataUri(cid: string, name: string): Promise<string> {
    const read = (fr: FileReader, mediaFile: Blob | File) =>
      fr.readAsDataURL(mediaFile);
    return this.getAsset(cid, name, read) as Promise<string>;
  }

  static async zip(cid: string): Promise<JSZip> {
    const zip = new JSZip();
    const files = await IDBService.getAll(`package:${cid}`);

    for (const file of files) {
      zip.file(file.name, file);
    }
    return zip;
  }
}
