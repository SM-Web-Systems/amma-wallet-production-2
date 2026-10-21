import { Wallet, StellarConfiguration } from "@stellar/typescript-wallet-sdk";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config";

class StellarClient {
  private static instance: StellarClient;
  public wallet: Wallet;
  public horizon: StellarSdk.Horizon.Server;
  public rpc: StellarSdk.rpc.Server;
  public networkPassphrase: string;
  private _stellar: ReturnType<Wallet["stellar"]>;
  private _account: ReturnType<ReturnType<Wallet["stellar"]>["account"]>;

  private constructor() {
    const isTestnet = config.STELLAR_NETWORK === "testnet";

    this.wallet = new Wallet({
      stellarConfiguration: isTestnet
        ? StellarConfiguration.TestNet()
        : StellarConfiguration.MainNet(),
    });

    this.horizon = new StellarSdk.Horizon.Server(
      isTestnet
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org"
    );

    this.rpc = new StellarSdk.rpc.Server(
      isTestnet
        ? "https://soroban-testnet.stellar.org"
        : config.SOROBAN_RPC_URL
    );

    this.networkPassphrase = isTestnet
      ? StellarSdk.Networks.TESTNET
      : StellarSdk.Networks.PUBLIC;

    this._stellar = this.wallet.stellar();
    this._account = this._stellar.account();
  }

  static getInstance(): StellarClient {
    if (!StellarClient.instance) {
      StellarClient.instance = new StellarClient();
    }
    return StellarClient.instance;
  }

  get stellar() {
    return this._stellar;
  }

  get account() {
    return this._account;
  }
}

export const stellarClient = StellarClient.getInstance();
