import { useEffect, useState } from "react";
import { Box, Button, Link, Typography } from "@mui/material";
import PackagesFab from "./components/PackagesFab";
import IDBService from "./services/IDB.service";
import { TypedPackage } from "./interfaces/TypedPackage";
import LoginDialog from "./components/LoginDialog";
import Loading from "./components/Loading";
import LTOService from "./services/LTO.service";
import Sidebar from "./components/Sidebar";
import LocalStorageService from "./services/LocalStorage.service";
import SessionStorageService from "./services/SessionStorage.service";
import OwnableService from "./services/Ownable.service";
import If from "./components/If";
import PackageService, { HAS_EXAMPLES } from "./services/Package.service";
import Grid from "@mui/material/Unstable_Grid2";
import * as React from "react";
import Ownable from "./components/Ownable";
import { EventChain } from "@ltonetwork/lto";
import HelpDrawer from "./components/HelpDrawer";
import AppToolbar from "./components/AppToolbar";
import AlertDialog from "./components/AlertDialog";
import { AlertColor } from "@mui/material/Alert/Alert";
import ownableErrorMessage from "./utils/ownableErrorMessage";
import Overlay from "./components/Overlay";
import ConfirmDialog from "./components/ConfirmDialog";
import { SnackbarProvider, enqueueSnackbar } from "notistack";
import { TypedOwnableInfo } from "./interfaces/TypedOwnableInfo";
import CreateOwnable from "./components/CreateOwnable";
import { RelayService } from "./services/Relay.service";
import { PollingService } from "./services/Polling.service";

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [showLogin, setShowLogin] = useState(!LTOService.isUnlocked());
  const [showSidebar, setShowSidebar] = useState(false);
  const [showPackages, setShowPackages] = React.useState(false);
  const [address, setAddress] = useState(LTOService.address);
  const [message, setMessages] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  // const [ownables, setOwnables] = useState<
  //   Array<{ chain: EventChain; package: string }>
  // >([]);
  const [ownables, setOwnables] = useState<
    Array<{ chain: EventChain; package: string; uniqueMessageHash?: string }>
  >([]);
  const [consuming, setConsuming] = useState<{
    chain: EventChain;
    package: string;
    info: TypedOwnableInfo;
  } | null>(null);
  const [alert, setAlert] = useState<{
    title: string;
    message: React.ReactNode;
    severity: AlertColor;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    severity?: AlertColor;
    ok?: string;
    onConfirm: () => void;
  } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    IDBService.open()
      .then(() => OwnableService.loadAll())
      .then((ownables) => setOwnables(ownables))
      .then(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!showLogin && address.length > 1) {
      const stopPolling = PollingService.startPolling(
        address,
        (newCount: any) => {
          setMessages(newCount);
        },
        5000
      );
      return () => stopPolling();
    }
  }, [address, showLogin]);

  const showError = (title: string, message: string) => {
    setAlert({ severity: "error", title, message });
  };

  const onLogin = () => {
    setShowLogin(false);
    setAddress(LTOService.address);
  };

  const logout = () => {
    setShowSidebar(false);
    LTOService.lock();
    setShowLogin(true);
  };

  const removeOwnable = (ownableId: string) => {
    setOwnables((prevOwnables) =>
      prevOwnables.filter((ownable) => ownable.chain.id !== ownableId)
    );
  };

  const forge = async (pkg: TypedPackage) => {
    const chain = await OwnableService.create(pkg);
    setOwnables([...ownables, { chain, package: pkg.cid }]);
    setShowPackages(false);
    enqueueSnackbar(`${pkg.title} forged`, { variant: "success" });
  };

  const relayImport = async (
    pkg: TypedPackage[] | null,
    triggerRefresh: boolean
  ) => {
    if (isImporting) return;

    const batchNumber = 2;

    if (pkg === null || pkg.length === 0) {
      enqueueSnackbar(`Nothing to Load from relay`, {
        variant: "error",
      });
      setIsImporting(false);
      return;
    }

    // Process batches of packages
    for (let i = 0; i < pkg.length; i += batchNumber) {
      const batch = pkg.slice(i, i + batchNumber);
      const filteredBatch = batch.filter(
        (item) => item !== null && item !== undefined
      );

      setOwnables((prevOwnables) => [
        ...prevOwnables,
        ...filteredBatch
          .filter((data: TypedPackage) => data.chain && data.cid)
          .map((data: TypedPackage) => ({
            chain: data.chain,
            package: data.cid,
            uniqueMessageHash: data.uniqueMessageHash, // Include uniqueMessageHash
          })),
      ]);

      enqueueSnackbar(`Ownable successfully loaded`, {
        variant: "success",
      });
      LocalStorageService.remove("messageCount");
      setMessages(0);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // Trigger a refresh only for updated ownables
    if (triggerRefresh) {
      setAlert({
        severity: "info",
        title: "New Ownables Detected",
        message: "New ownables have been detected. Refreshing...",
      });

      setTimeout(() => {
        window.location.reload();
      }, 7000);
    }

    setIsImporting(false);
  };

  const deleteOwnable = (
    id: string,
    packageCid: string,
    uniqueMessageHash?: string
  ) => {
    const pkg = PackageService.info(packageCid);
    console.log(pkg, uniqueMessageHash);

    setConfirm({
      severity: "error",
      title: "Confirm delete",
      message: (
        <span>
          Are you sure you want to delete this <em>{pkg.title}</em> Ownable?
        </span>
      ),
      ok: "Delete",
      onConfirm: async () => {
        setOwnables((current) =>
          current.filter((ownable) => ownable.chain.id !== id)
        );
        //Delete ownable
        await OwnableService.delete(id);

        //delete ownable from relay
        const uniqueMessageHash = pkg.uniqueMessageHash;

        //Update knownhashes in localstorage
        await LocalStorageService.removeItem(
          "messageHashes",
          pkg.uniqueMessageHash
        );

        await LocalStorageService.removeByField(
          "packages",
          "uniqueMessageHash",
          pkg.uniqueMessageHash
        );

        if (uniqueMessageHash) {
          await RelayService.removeOwnable(uniqueMessageHash);
        }
      },
    });
  };

  const canConsume = async (consumer: {
    chain: EventChain;
    package: string;
  }): Promise<boolean> => {
    try {
      return (
        !!consuming?.info &&
        (await OwnableService.canConsume(consumer, consuming!.info))
      );
    } catch (e) {
      console.error(e, (e as any).cause);
      return false;
    }
  };

  const consume = (consumer: EventChain, consumable: EventChain) => {
    if (consumer.id === consumable.id) return;

    OwnableService.consume(consumer, consumable)
      .then(() => {
        setConsuming(null);
        setOwnables((ownables) => [...ownables]);
        enqueueSnackbar("Consumed", { variant: "success" });
      })
      .catch((error) =>
        showError("Consume failed", ownableErrorMessage(error))
      );
  };

  const reset = async () => {
    setShowSidebar(false);
    if (ownables.length === 0) return;

    setConfirm({
      severity: "error",
      title: "Confirm delete",
      message: (
        <span>
          Are you sure you want to delete <strong>all Ownables</strong>?
        </span>
      ),
      ok: "Delete all",
      onConfirm: async () => {
        setOwnables([]);
        await OwnableService.deleteAll();
        enqueueSnackbar("All Ownables are deleted");
      },
    });
  };

  const factoryReset = async () => {
    setShowSidebar(false);

    setConfirm({
      severity: "error",
      title: "Factory reset",
      message: (
        <span>
          Are you sure you want to delete all Ownables, all packages and your
          account? <strong>This is a destructive action.</strong>
        </span>
      ),
      ok: "Delete everything",
      onConfirm: async () => {
        setLoaded(false);

        LocalStorageService.clear();
        SessionStorageService.clear();
        await IDBService.deleteDatabase();

        window.location.reload();
      },
    });
  };

  return (
    <>
      <AppToolbar onMenuClick={() => setShowSidebar(true)} />
      <If condition={ownables.length === 0}>
        <Grid
          container
          spacing={0}
          direction="column"
          alignItems="center"
          justifyContent="center"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: -1,
          }}
        >
          <Grid xs={10}>
            <Typography variant="h3" color="text.primary" textAlign="center">
              Let's get started!
            </Typography>
            <Typography
              variant="subtitle1"
              color="text.secondary"
              textAlign="center"
              sx={{ mt: 2 }}
            >
              Read{" "}
              <Link
                href="https://docs.ltonetwork.com/ownables/what-are-ownables"
                target="_blank"
              >
                the documentation
              </Link>{" "}
              to learn how to issue an Ownable
              <If condition={HAS_EXAMPLES}>
                <br />
                or try one of{" "}
                <Link
                  component="button"
                  onClick={() => setShowPackages(true)}
                  style={{ fontSize: "inherit" }}
                >
                  the examples
                </Link>
              </If>
              .
              <br />
              Or you can also{" "}
              <Link
                component="button"
                onClick={() => setShowCreate(true)}
                style={{ fontSize: "inherit" }}
              >
                create your own
              </Link>
              .
            </Typography>
          </Grid>
        </Grid>
      </If>

      <Grid
        container
        sx={{ maxWidth: 1400, margin: "auto", mt: 2 }}
        columnSpacing={6}
        rowSpacing={4}
      >
        {ownables.map(({ chain, package: packageCid, uniqueMessageHash }) => (
          <Grid
            key={chain.id}
            xs={12}
            sm={6}
            md={4}
            sx={{ position: "relative" }}
          >
            <Ownable
              chain={chain}
              packageCid={packageCid}
              uniqueMessageHash={uniqueMessageHash}
              selected={consuming?.chain.id === chain.id}
              onDelete={() =>
                deleteOwnable(chain.id, packageCid, uniqueMessageHash)
              }
              onRemove={() => removeOwnable(chain.id)}
              onConsume={(info) =>
                setConsuming({ chain, package: packageCid, info })
              }
              onError={showError}
            >
              <If condition={consuming?.chain.id === chain.id}>
                <Overlay zIndex={1000} />
              </If>
              <If
                condition={
                  consuming !== null && consuming.chain.id !== chain.id
                }
              >
                <Overlay
                  zIndex={1000}
                  disabled={canConsume({ chain, package: packageCid }).then(
                    (can) => !can
                  )}
                  onClick={() => consume(chain, consuming!.chain)}
                />
              </If>
            </Ownable>
          </Grid>
        ))}
      </Grid>

      <PackagesFab
        open={showPackages}
        onOpen={() => setShowPackages(true)}
        onClose={() => setShowPackages(false)}
        onSelect={forge}
        onImportFR={(pkg, triggerRefresh) => relayImport(pkg, triggerRefresh)}
        onError={showError}
        onCreate={() => setShowCreate(true)}
        message={message}
      />

      <Sidebar
        open={showSidebar}
        onClose={() => setShowSidebar(false)}
        onLogout={logout}
        onReset={reset}
        onFactoryReset={factoryReset}
      />

      <CreateOwnable open={showCreate} onClose={() => setShowCreate(false)} />

      <LoginDialog key={address} open={loaded && showLogin} onLogin={onLogin} />

      <HelpDrawer open={consuming !== null}>
        <Typography component="span" sx={{ fontWeight: 700 }}>
          Select which Ownable should consume this{" "}
          <em>
            {consuming ? PackageService.info(consuming.package).title : ""}
          </em>
        </Typography>
        <Box>
          <Button
            sx={(theme) => ({ color: theme.palette.primary.contrastText })}
            onClick={() => setConsuming(null)}
          >
            Cancel
          </Button>
        </Box>
      </HelpDrawer>

      <SnackbarProvider />
      <AlertDialog
        open={alert !== null}
        onClose={() => setAlert(null)}
        {...alert!}
      >
        {alert?.message}
      </AlertDialog>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        {...confirm!}
      >
        {confirm?.message}
      </ConfirmDialog>
      <Loading show={!loaded} />
    </>
  );
}
