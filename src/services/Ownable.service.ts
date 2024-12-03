import { EventChain, Event, Binary } from "@ltonetwork/lto";
import LTOService from "./LTO.service";
import IDBService from "./IDB.service";
import TypedDict from "../interfaces/TypedDict";
import PackageService from "./Package.service";
import { Cancelled } from "simple-iframe-rpc";

// @ts-ignore - Loaded as string, see `craco.config.js`
import workerJsSource from "../assets/worker.js";
import JSZip from "jszip";
import { TypedPackage } from "../interfaces/TypedPackage";
import { TypedOwnableInfo } from "../interfaces/TypedOwnableInfo";
import EventChainService from "./EventChain.service";
import LocalStorageService from "./LocalStorage.service";

export type StateDump = Array<[ArrayLike<number>, ArrayLike<number>]>;

interface MessageInfo {
  sender: string;
  funds: Array<{}>;
}

interface CosmWasmEvent {
  type: string;
  attributes: TypedDict<string>;
}

export interface OwnableRPC {
  init: (id: string, js: string, wasm: Uint8Array) => Promise<any>;
  instantiate: (
    msg: TypedDict,
    info: MessageInfo
  ) => Promise<{ attributes: TypedDict<string>; state: StateDump }>;
  execute: (
    msg: TypedDict,
    info: MessageInfo,
    state: StateDump
  ) => Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }>;
  externalEvent: (
    msg: TypedDict,
    info: TypedDict,
    state: StateDump
  ) => Promise<{
    attributes: TypedDict<string>;
    events: Array<CosmWasmEvent>;
    data: string;
    state: StateDump;
  }>;
  query: (msg: TypedDict, state: StateDump) => Promise<any>;
  refresh: (state: StateDump) => Promise<void>;
}

export default class OwnableService {
  private static _anchoring = !!LocalStorageService.get("anchoring");

  static get anchoring(): boolean {
    return this._anchoring;
  }
  static set anchoring(enabled: boolean) {
    LocalStorageService.set("anchoring", enabled);
    this._anchoring = enabled;
  }

  private static readonly _rpc = new Map<string, OwnableRPC>();

  static async loadAll(): Promise<
    Array<{
      chain: EventChain;
      package: string;
      created: Date;
      keywords: string[];
      uniqueMessageHash?: string;
    }>
  > {
    return EventChainService.loadAll();
  }

  static rpc(id: string): OwnableRPC {
    const rpc = this._rpc.get(id);
    if (!rpc) throw new Error(`No RPC for ownable ${id}`);
    return rpc;
  }

  static clearRpc(id: string) {
    const rpc = this._rpc.get(id);
    if (!rpc) return;

    try {
      delete (rpc as any).handler;
    } catch (e) {
      if (e instanceof Cancelled) return;
      throw e;
    }
    this._rpc.delete(id);
  }

  static async create(pkg: TypedPackage): Promise<EventChain> {
    const account = LTOService.account;
    const chain = EventChain.create(account);
    const anchors: Array<{ key: Binary; value: Binary }> = [];

    console.log(pkg);
    if (pkg.isDynamic) {
      const msg = {
        "@context": "instantiate_msg.json",
        ownable_id: chain.id,
        package: pkg.cid,
        network_id: LTOService.networkId,
        keywords: pkg.keywords,
      };
      new Event(msg).addTo(chain).signWith(account);
    }

    if (this.anchoring) {
      const hash = chain.latestHash.hex;
      anchors.push(...chain.startingWith(Binary.fromHex(hash)).anchorMap);
    }

    if (anchors.length > 0) {
      await LTOService.anchor(...anchors);
    }

    return chain;
  }

  static async init(
    chain: any,
    cid: string,
    rpc: OwnableRPC,
    uniqueMessageHash?: string
  ): Promise<void> {
    if (this._rpc.has(chain.id)) {
      try {
        delete (this._rpc.get(chain.id) as any).handler;
      } catch (e) {}
    }

    this._rpc.set(chain.id, rpc);
    const moduleJs = await PackageService.getAssetAsText(cid, "ownable.js");
    const js = workerJsSource + moduleJs;

    const wasm = (await PackageService.getAsset(
      cid,
      "ownable_bg.wasm",
      (fr, file) => fr.readAsArrayBuffer(file)
    )) as ArrayBuffer;
    await rpc.init(chain.id, js, new Uint8Array(wasm));
    const stateDump = await this.apply(chain, []);
    await this.initStore(chain, cid, uniqueMessageHash, stateDump);
  }

  static async apply(
    partialChain: EventChain,
    stateDump: StateDump
  ): Promise<StateDump> {
    const rpc = this.rpc(partialChain.id);

    for (const event of partialChain.events) {
      stateDump = (await this.applyEvent(rpc, event, stateDump)).state;
    }

    return stateDump;
  }

  private static async applyEvent(
    rpc: OwnableRPC,
    event: Event,
    stateDump: StateDump
  ): Promise<{ result?: TypedDict; state: StateDump }> {
    const info = {
      sender: event.signKey!.publicKey.base58
        ? event.signKey!.publicKey.base58
        : event.signKey!.publicKey.toString(),
      funds: [],
    };
    const { "@context": context, ...msg } = event.parsedData;

    switch (context) {
      case "instantiate_msg.json":
        return await rpc.instantiate(msg, info);
      case "execute_msg.json":
        return await rpc.execute(msg, info, stateDump);
      case "external_event_msg.json":
        const message = {
          msg: {
            event_type: msg.type,
            attributes: msg.attributes,
            network: "",
          },
        };
        return await rpc.externalEvent(message, info, stateDump);
      default:
        throw new Error(`Unknown event type`);
    }
  }

  static async execute(
    chain: EventChain,
    msg: TypedDict,
    stateDump: StateDump
  ): Promise<StateDump> {
    const info = { sender: LTOService.account.publicKey, funds: [] };
    const { state: newStateDump } = await this.rpc(chain.id).execute(
      msg,
      info,
      stateDump
    );

    delete msg["@context"]; // Shouldn't be set
    new Event({ "@context": "execute_msg.json", ...msg })
      .addTo(chain)
      .signWith(LTOService.account);

    await EventChainService.store({ chain, stateDump });

    return newStateDump;
  }

  static async canConsume(
    consumer: { chain: EventChain; package: string },
    info: TypedOwnableInfo
  ): Promise<boolean> {
    if (!PackageService.info(consumer.package).isConsumer) return false;

    return true; // TODO: The check below is not working

    /*const state = await EventChainService.getStateDump(consumer.chain.id, consumer.chain.state);
    if (!state) return false;

    return await this.rpc(consumer.chain.id)
      .query({is_consumer_of: {consumable_type: info.ownable_type, issuer: info.issuer}}, state!);*/
  }

  static async consume(
    consumer: EventChain,
    consumable: EventChain
  ): Promise<void> {
    const info: MessageInfo = {
      sender: LTOService.account.publicKey,
      funds: [],
    };
    const consumeMessage = { consume: {} };
    const consumerState = await EventChainService.getStateDump(
      consumer.id,
      consumer.state
    );
    const consumableState = await EventChainService.getStateDump(
      consumable.id,
      consumable.state
    );
    if (!consumerState || !consumableState)
      throw Error("State mismatch for consume");

    const { events, state: consumableStateDump } = await this.rpc(
      consumable.id
    ).execute(consumeMessage, info, consumableState);

    const consumeEvent:
      | { contract?: string; type: string; attributes: TypedDict<string> }
      | undefined = events.find((event) => event.type === "consume");
    if (!consumeEvent) throw Error("No consume event emitted");
    consumeEvent.contract = consumable.id;

    const externalEventMsg = {
      msg: {
        attributes: consumeEvent.attributes,
        network: "",
        event_type: consumeEvent.type,
      },
    };

    const { state: consumerStateDump } = await this.rpc(
      consumer.id
    ).externalEvent(externalEventMsg, info, consumerState);

    new Event({ "@context": "execute_msg.json", ...consumeMessage })
      .addTo(consumable)
      .signWith(LTOService.account);
    new Event({ "@context": "external_event_msg.json", ...consumeEvent })
      .addTo(consumer)
      .signWith(LTOService.account);

    await EventChainService.store(
      { chain: consumable, stateDump: consumableStateDump },
      { chain: consumer, stateDump: consumerStateDump }
    );
  }

  private static async ensureDBConnection(): Promise<void> {
    try {
      await IDBService.listStores();
    } catch (e) {
      console.warn("IDB connection lost, attempting to reconnect...");
      await IDBService.open();
    }
  }

  private static async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    //let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.ensureDBConnection();
        return await operation();
      } catch (error) {
        //lastError = error as Error;
        console.warn(`Attempt ${attempt} failed:`, error);

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }

    throw new Error(
      `Operation failed after ${maxRetries} attempts. Last error: `
    );
  }

  static async initStore(
    chain: EventChain,
    pkg: string,
    uniqueMessageHash?: string,
    stateDump?: StateDump
  ): Promise<void> {
    const storeId = `ownable:${chain.id}`;
    const stateStoreId = `${storeId}.state`;

    console.log(uniqueMessageHash);

    const chainData = {
      chain: chain.toJSON(),
      state: chain.state.hex,
      package: pkg,
      created: new Date(),
      latestHash: chain.latestHash.hex,
      keywords: PackageService.info(pkg).keywords,
      uniqueMessageHash: PackageService.info(pkg, uniqueMessageHash)
        .uniqueMessageHash,
    };

    const stores = [storeId];
    if (stateDump) stores.push(stateStoreId);

    await this.retryOperation(async () => {
      const hasStore = await IDBService.hasStore(storeId);
      if (hasStore) {
        return;
      }

      await IDBService.createStore(...stores);

      const data: TypedDict = {
        [storeId]: chainData,
      };

      if (stateDump) {
        data[stateStoreId] = new Map(stateDump);
      }

      try {
        await IDBService.setAll(data);
      } catch (error) {
        // If setAll fails, attempt to clean up
        console.error("Failed to set data, cleaning up stores...");
        await Promise.all(
          stores.map((store) =>
            IDBService.deleteStore(store).catch((e) =>
              console.warn(`Failed to clean up store ${store}:`, e)
            )
          )
        );
        throw error;
      }

      const verifyData = await Promise.all([
        IDBService.get(storeId, "state"),
        stateDump ? IDBService.getAll(stateStoreId) : Promise.resolve(null),
      ]);

      if (
        verifyData[0] !== chainData.state ||
        (stateDump && !verifyData[1]?.length)
      ) {
        throw new Error("Data verification failed after write");
      }
    });
  }

  static async store(chain: EventChain, stateDump: StateDump): Promise<void> {
    const storeId = `ownable:${chain.id}`;
    const stateStoreId = `${storeId}.state`;

    await this.retryOperation(async () => {
      const storedState = await IDBService.get(storeId, "state");
      if (storedState === chain.state) return;

      const data = {
        [storeId]: {
          chain: chain.toJSON(),
          state: chain.state.hex,
        },
        [stateStoreId]: new Map(stateDump),
      };

      await IDBService.setAll(data);

      // Verify the write
      const verifyState = await IDBService.get(storeId, "state");
      if (verifyState !== chain.state.hex) {
        throw new Error("State verification failed after write");
      }
    });
  }


  static async delete(id: string): Promise<void> {
    await EventChainService.delete(id);
  }

  static async deleteAll(): Promise<void> {
    await EventChainService.deleteAll();
  }

  static async zip(chain: EventChain): Promise<JSZip> {
    const packageCid: string = chain.events[0].parsedData.package;

    const zip = await PackageService.zip(packageCid);
    zip.file("chain.json", JSON.stringify(chain.toJSON()));

    return zip;
  }
}
