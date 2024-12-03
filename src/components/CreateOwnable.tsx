import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Hidden,
  IconButton,
  Input,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";
import LTOService from "../services/LTO.service";
import useInterval from "../utils/useInterval";
import Dialog from "@mui/material/Dialog";
import JSZip from "jszip";
import axios from "axios";
import heic2any from "heic2any";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import { Transfer as TransferTx, getNetwork } from "@ltonetwork/lto";
import { TypedOwnable } from "../interfaces/TypedOwnableInfo";
import { useSnackbar } from "notistack";
import TagInputField from "./TagInputField";
import { sign } from "@ltonetwork/http-message-signatures";
interface CreateOwnableProps {
  open: boolean;
  onClose: () => void;
}

export default function CreateOwnable(props: CreateOwnableProps) {
  const { open, onClose } = props;
  const ltoWalletAddress = LTOService.address;
  const [showNoBalance, setShowNoBalance] = useState(false);
  const [balance, setBalance] = useState<number>();
  const [ownable, setOwnable] = useState<TypedOwnable>({
    owner: "",
    //email: "",
    name: "",
    description: "",
    keywords: [],
    evmAddress: "",
    network: "arbitrum",
    image: null,
  });
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [available, setAvailable] = useState(0);
  const [lowBalance, setLowBalance] = useState(false);
  const [amount, setAmount] = useState(0);
  const [showAmount, setShowAmount] = useState<number>(0);
  const [recipient, setShowAddress] = useState<string | undefined>();
  const [noConnection, setNoConnection] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState("arbitrum");
  const [thumbnail, setThumbnail] = useState<Blob | null>(null);
  const [blurThumbnail, setBlurThumbnail] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  // const getPlaceholderText = (network: string) => {
  //   switch (network) {
  //     case "ethereum":
  //       return "Ethereum Address";
  //     case "arbitrum":
  //       return "Arbitrum Address";
  //     default:
  //       return "Address";
  //   }
  // };

  const fetchBuildAmount = useCallback(async () => {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_OBUILDER}/api/v1/templateCost?templateId=1`,
        {
          headers: {
            Accept: "*/*",
          },
        }
      );
	  let value;
	  if(process.env.REACT_APP_LTO_NETWORK_ID === 'L') {
		value = +response.data.L[selectedNetwork];
	  } else {
		value = +response.data.T[selectedNetwork];
	  }
      console.log("Value:", value);
      const address = await axios.get(
        // `${process.env.REACT_APP_OBUILDER}/api/v1/ServerWalletAddressLTO`,
        `${process.env.REACT_APP_OBUILDER}/api/v1/GetServerInfo`,
        {
          headers: {
            Accept: "*/*",
          },
        }
      );
      //const serverAddress_L = address.data.serverLtoWalletAddress_L;
    //   const serverAddress_T = address.data.serverLtoWalletAddress_T;
	  let serverAddress;
	  if(process.env.REACT_APP_LTO_NETWORK_ID === 'L') {
		serverAddress = address.data.serverLtoWalletAddress_L;
	  }else {
		serverAddress = address.data.serverLtoWalletAddress_T;
	  }
      const LTO_REPRESENTATION = 100000000;
      const calculatesAmount =
        parseFloat(value.toString()) / LTO_REPRESENTATION + 1;
      if (calculatesAmount < 1.1) {
        console.error("error server is not ready yet");
        return;
      } else {
        setAmount(value);
        setShowAmount(calculatesAmount);
        setShowAddress(serverAddress);
      }
    } catch (error) {
      //console.error("Error fetching build amount:", error);
      setNoConnection(true);
    }
  }, [selectedNetwork]);

  useEffect(() => {
    fetchBuildAmount();
  }, [fetchBuildAmount]);

  const handleCloseDialog = () => {
    setOpenDialog(false);
  };

  const handleClose = () => {
    handleCloseDialog();
    clearFields();
    clearImageAndThumbnail();
    setBlurThumbnail(false);
    onClose();
  };

  const { enqueueSnackbar } = useSnackbar();

  const handleCopy = () => {
    navigator.clipboard.writeText(ltoWalletAddress);
    enqueueSnackbar("Address copied to clipboard", { variant: "success" });
  };

  const clearFields = () => {
    setOwnable({
      owner: "",
      //email: "",
      name: "",
      description: "",
      keywords: [],
      evmAddress: "",
      network: "arbitrum",
      image: null,
    });
    setSelectedNetwork("arbitrum");
  };

  const loadBalance = () => {
    if (!LTOService.isUnlocked()) return;

    LTOService.getBalance().then(({ regular }) => {
      setBalance(parseFloat((regular / 100000000).toFixed(2)));
      setAvailable(regular);
    });
  };

  useEffect(() => loadBalance(), []);
  useInterval(() => loadBalance(), 5 * 1000);

  useEffect(() => {
    if (balance !== undefined && balance < 0.1) {
      setShowNoBalance(true);
      return;
    }
  }, [balance]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setOwnable((prevOwnable) => ({
      ...prevOwnable,
      [name]: value,
    }));
  };

  const handleNetworkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setOwnable((prevOwnable) => ({
      ...prevOwnable,
      network: value,
    }));
    fetchBuildAmount();
  };

  const clearImageAndThumbnail = () => {
    setThumbnail(null);
    setOwnable((prevOwnable) => ({
      ...prevOwnable,
      image: null,
    }));
    const fileInput = document.getElementById("fileUpload") as HTMLInputElement;
    if (fileInput) {
      fileInput.value = "";
    }
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    format: "webp" | "gif" = "webp"
  ) => {
    let file = e.target.files?.[0] || null;

    if (file && file.type === "image/heic") {
      // Convert HEIC to desired format
      const blob = await heic2any({
        blob: file,
        toType: format === "gif" ? "image/gif" : "image/webp",
        quality: 0.7,
      });

      if (blob instanceof Blob) {
        file = new File([blob], file.name, {
          type: format === "gif" ? "image/gif" : "image/webp",
        });
      }
    }

    if (file) {
      // Resize the image
      const resizedImage = await resizeImage(file, format);
      file = new File([resizedImage], file.name, {
        type: format === "gif" ? "image/gif" : "image/webp",
      });

      // Generate a thumbnail (defaulting to WebP)
      const thumbnailImage = await createThumbnail(resizedImage, format);
      setThumbnail(thumbnailImage);
    }

    // Update the state with the processed file
    setOwnable((prevOwnable) => ({
      ...prevOwnable,
      image: file,
    }));
  };

  async function createThumbnail(
    blob: Blob,
    format: "webp" | "gif" = "webp"
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Set thumbnail size
        canvas.width = 50;
        canvas.height = 50;

        // Draw image on the canvas
        ctx!.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Export the canvas as the specified format
        const mimeType = format === "gif" ? "image/gif" : "image/webp";
        canvas.toBlob((thumbnailBlob) => {
          if (thumbnailBlob) {
            resolve(thumbnailBlob);
          } else {
            reject(new Error("Could not create thumbnail blob"));
          }
        }, mimeType);
      };

      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }

  const handleThumbnailUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    let file = e.target.files?.[0] || null;
    if (file && file.type === "image/heic") {
      const blob = await heic2any({
        blob: file,
        toType: "image/webp",
        quality: 0.7,
      });
      if (blob instanceof Blob) {
        file = new File([blob], file.name, { type: "image/webp" });
      }
    }

    if (file) {
      const resizedImage = await resizeImage(file);
      file = new File([resizedImage], file.name, { type: "image/webp" });
      const thumbnailImage = await createThumbnail(resizedImage);
      setThumbnail(thumbnailImage);
    }
  };

  async function resizeImage(
    file: File,
    format: "webp" | "gif" = "webp"
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // Create a canvas
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (width === height) {
          // Square image: Use original dimensions
          canvas.width = width;
          canvas.height = height;
          ctx!.drawImage(img, 0, 0, width, height);
        } else {
          // Non-square image: Create a square canvas with transparent background
          const maxSize = Math.max(width, height);
          canvas.width = maxSize;
          canvas.height = maxSize;

          // Fill with transparent background
          ctx!.fillStyle = "rgba(0, 0, 0, 0)";
          ctx!.fillRect(0, 0, maxSize, maxSize);

          // Center the image
          const x = maxSize / 2 - width / 2;
          const y = maxSize / 2 - height / 2;
          ctx!.drawImage(img, x, y, width, height);
        }

        // Export the image as WebP or GIF
        const mimeType = format === "gif" ? "image/gif" : "image/webp";

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Could not create blob"));
          }
        }, mimeType);
      };

      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function getThumbnailBlob(
    thumbnail: File | Blob,
    blur: boolean
  ): Promise<Blob> {
    if (!blur) {
      return thumbnail;
    }

    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("2D context could not be created"));
        return;
      }
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.filter = "blur(5px)";
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Blob conversion failed"));
          }
        }, "image/webp");
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(thumbnail);
    });
  }

  const handleCreateOwnable = async () => {
    const requiredFields = ["name", "network", "owner", "image"];
    let newMissingFields: string[] = [];
    for (let field of requiredFields) {
      if (!ownable[field as keyof TypedOwnable]) {
        console.error(`Missing required field: ${field}`);
        newMissingFields.push(field);
      }
    }
    setMissingFields(newMissingFields);
    if (newMissingFields.length > 0) {
      return;
    }
    if (!recipient || !amount) {
      console.error("Recipient or amount is not defined");
      setNoConnection(true);
      return;
    }
    const tx = new TransferTx(recipient, amount);
    try {
      const account1 = await LTOService.getAccount();
      console.log("account1", account1.address);
      console.log("Network1", getNetwork(account1.address));
      const account = LTOService.account;
      console.log("account", account.address);
      console.log("Network", getNetwork(account.address));
      const transaction = await LTOService.broadcast(tx!.signWith(account));

      const url = `${process.env.REACT_APP_OBUILDER}/api/v1/upload`;
      const request = {
        headers: {},
        method: "POST",
        url,
      };
      const signedRequest = await sign(request, { signer: account });
      request.url =
        request.url + `?ltoNetworkId=${getNetwork(account.address)}`;
      console.log("signedRequest", signedRequest);
      const headers1 = {
        "Content-Type": "multipart/form-data",
        Accept: "*/*",
      };
      const combinedHeaders = { ...signedRequest.headers, ...headers1 };
      // const combinedHeaders = headers1;
      console.log("combinedHeaders", combinedHeaders);

      setTimeout(() => {
        if (transaction.id) {
          const imageType = "webp";
          const imageName = ownable.name.replace(/\s+/g, "-");
          const formattedName = ownable.name.toLowerCase().replace(/\s+/g, "_");
          const ownableData = [
            {
              template: "template1",
              CREATE_NFT: "true",
              NFT_BLOCKCHAIN: ownable.network,
              // NFT_TOKEN_URI:
              //   "https://black-rigid-chickadee-743.mypinata.cloud/ipfs/QmSHE3ReBy7b8kmVVbyzA2PdiYyxWsQNU89SsAnWycwMhB",
              OWNABLE_THUMBNAIL: "thumbnail.webp",
              OWNABLE_LTO_TRANSACTION_ID: transaction.id,
              PLACEHOLDER1_NAME: "ownable_" + formattedName,
              PLACEHOLDER1_DESCRIPTION: ownable.description,
              PLACEHOLDER1_VERSION: "0.1.0",
              //PLACEHOLDER1_AUTHORS: ownable.owner + " <" + ownable.email + ">",
              PLACEHOLDER1_KEYWORDS: tags,
              PLACEHOLDER2_TITLE: ownable.name,
              PLACEHOLDER2_IMG: imageName + "." + imageType,
              PLACEHOLDER4_TYPE: ownable.name,
              PLACEHOLDER4_DESCRIPTION: ownable.description,
              PLACEHOLDER4_NAME: ownable.name,
            },
          ];

          const zip = new JSZip();
          zip.file("ownableData.json", JSON.stringify(ownableData, null, 2));
          if (ownable.image) {
            zip.file(`${imageName}.${imageType}`, ownable.image);
          }

          if (thumbnail) {
            const thumbnailBlob = getThumbnailBlob(thumbnail, blurThumbnail);
            zip.file(`thumbnail.webp`, thumbnailBlob);
          }
          zip.generateAsync({ type: "blob" }).then((zipFile: Blob) => {
            // for testing creating download zip file, remove for live version
            // Create a temporary link element
            const link = document.createElement("a");
            link.href = URL.createObjectURL(zipFile);
            link.download = formattedName + ".zip";
            // Simulate a click on the link to trigger the download
            link.click();

            // Send the zip file to oBuilder
            // const url = `${process.env.REACT_APP_OBUILDER}/api/v1/upload`;
            const formData = new FormData();
            formData.append("file", zipFile, formattedName + ".zip");
            axios
              // .post(url, formData, {
              //   headers: {
              //     "Content-Type": "multipart/form-data",
              //     Accept: "*/*",
              //   },
              // })
              .post(request.url, formData, {
                headers: combinedHeaders,
              })
              .then((res) => {
                console.log(res.data);
              })
              .catch((err) => {
                console.log(err);
              });
            setOpenDialog(true);
          });
          handleCloseDialog();
        }
      }, 1000);
    } catch (error) {
      console.error("Error sending transaction:", error);
      setLowBalance(true);
    }
  };

  return (
    <>
      <Dialog onClose={handleClose} open={open}>
        <Box sx={{ maxWidth: "90%", p: 2 }}>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="flex-start"
          >
            <Box component="div" sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 12 }} color="text.secondary">
                LTO Network address
              </Typography>
              <Typography
                sx={{ fontSize: 12, fontWeight: 600 }}
                component="div"
                onClick={handleCopy}
                style={{ cursor: "pointer" }}
              >
                {ltoWalletAddress}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                balance: {balance !== undefined ? balance + " LTO" : ""}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                build cost:{" "}
                {showAmount !== undefined ? showAmount + " LTO" : ""} (incl.
                Fee: 1 LTO)
              </Typography>
            </Box>
            <Hidden smUp>
              <IconButton
                onClick={handleClose}
                size="small"
                sx={{ mr: 2, mt: -1 }}
              >
                <HighlightOffIcon />
              </IconButton>
            </Hidden>
          </Box>
          <Box
            component="div"
            sx={{ mt: 1, display: "flex", justifyContent: "center" }}
          ></Box>
          <Box>
            <Box component="div" sx={{ mt: 2 }}>
              <Box display="flex" flexDirection="column" alignItems="center">
                <Typography sx={{ fontSize: 12 }} color="text.secondary">
                  Choose your network
                </Typography>
                <RadioGroup
                  row
                  name="network"
                  value={ownable.network}
                  onChange={(event) => {
                    handleNetworkChange(event);
                    setSelectedNetwork(event.target.value);
                  }}
                  sx={{ justifyContent: "center" }}
                >
                  <FormControlLabel
                    value="ethereum"
                    control={
                      <Radio
                        sx={{
                          width: { xs: "12px", sm: "16px" },
                          height: { xs: "12px", sm: "16px" },
                        }}
                      />
                    }
                    label={
                      <Typography
                        sx={{
                          fontSize: {
                            xs: "0.7rem",
                            sm: "0.9rem",
                            md: "1.1rem",
                          },
                          ml: 1,
                        }}
                        color="text.secondary"
                      >
                        Ethereum
                      </Typography>
                    }
                  />
                  <FormControlLabel
                    value="arbitrum"
                    control={
                      <Radio
                        sx={{
                          width: { xs: "12px", sm: "16px" },
                          height: { xs: "12px", sm: "16px" },
                        }}
                      />
                    }
                    label={
                      <Typography
                        sx={{
                          fontSize: {
                            xs: "0.7rem",
                            sm: "0.9rem",
                            md: "1.1rem",
                          },
                          ml: 1,
                        }}
                        color="text.secondary"
                      >
                        Arbitrum
                      </Typography>
                    }
                  />
                </RadioGroup>
              </Box>
              <br></br>
              <Input
                error={missingFields.includes("owner")}
                fullWidth
                type="text"
                name="owner"
                placeholder="Owner name"
                value={ownable.owner}
                onChange={handleInputChange}
                sx={{ fontSize: { xs: "0.8rem", sm: "1rem", md: "1.2rem" } }}
                required
              />
              {/* <Input
                error={missingFields.includes("email")}
                fullWidth
                type="email"
                name="email"
                placeholder="Owner email"
                value={ownable.email}
                onChange={handleInputChange}
                sx={{ fontSize: { xs: "0.8rem", sm: "1rem", md: "1.2rem" } }}
                required
              /> */}
              <Box component="div" sx={{ mt: 2 }}>
                <Input
                  error={missingFields.includes("name")}
                  fullWidth
                  type="text"
                  name="name"
                  placeholder="Ownable name"
                  value={ownable.name}
                  onChange={handleInputChange}
                  sx={{
                    fontSize: { xs: "0.8rem", sm: "1rem", md: "1.2rem" },
                  }}
                  required
                />
                <Input
                  fullWidth
                  type="text"
                  name="description"
                  placeholder="Description"
                  value={ownable.description}
                  onChange={handleInputChange}
                  sx={{
                    fontSize: { xs: "0.8rem", sm: "1rem", md: "1.2rem" },
                  }}
                  required
                />
                <br></br>
                <br></br>
                <TagInputField onTagsChange={setTags} />
                <br></br>
                <br></br>
                <label
                  htmlFor="fileUpload"
                  className="custom-file-upload"
                  style={{
                    display: "inline-block",
                    padding: "6px 12px",
                    cursor: "pointer",
                    backgroundColor: "#1cb7ff",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    textAlign: "center",
                    textDecoration: "none",
                    transitionDuration: "0.4s",
                    margin: "10px 0",
                  }}
                >
                  Choose File
                </label>
                <br></br>
                <input
                  id="fileUpload"
                  className={missingFields.includes("image") ? "error" : ""}
                  type="file"
                  accept="image/*,.heic"
                  onChange={handleImageUpload}
                  style={{ marginBottom: "10px", display: "none" }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-around",
                  }}
                >
                  {ownable.image && (
                    <div>
                      <img
                        src={URL.createObjectURL(ownable.image)}
                        alt="Selected"
                        style={{ width: "100px", height: "auto" }}
                      />
                    </div>
                  )}
                  {thumbnail && (
                    <>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "smaller", lineHeight: "1" }}>
                          Wallet
                          <br />
                          thumbnail
                        </div>
                        <img
                          src={URL.createObjectURL(thumbnail)}
                          alt="Thumbnail"
                          style={{
                            width: "50px",
                            height: "auto",
                            filter: blurThumbnail ? "blur(5px)" : "none",
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
                <br></br>
                {thumbnail && (
                  <>
                    <Button onClick={() => setBlurThumbnail(!blurThumbnail)}>
                      {blurThumbnail ? "Unblur Thumbnail" : "Blur Thumbnail"}
                    </Button>
                    <br></br>
                    <Button>
                      <label
                        htmlFor="thumbUpload"
                        className="custom-file-upload"
                      >
                        Change Thumbnail
                      </label>
                    </Button>
                    <input
                      id="thumbUpload"
                      type="file"
                      accept="image/*,.heic"
                      onChange={handleThumbnailUpload}
                      style={{ marginBottom: "10px", display: "none" }}
                    />
                  </>
                )}
                <Box
                  component="div"
                  sx={{ mt: 1, display: "flex", justifyContent: "center" }}
                >
                  <Button
                    variant="contained"
                    sx={{ mt: 2 }}
                    onClick={handleCreateOwnable}
                    disabled={
                      isNaN(amount) || amount <= 0 || amount > available
                    }
                  >
                    Create Ownable
                  </Button>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
        <Dialog
          open={noConnection}
          hideBackdrop
          onClose={() => setNoConnection(false)}
        >
          <Alert variant="outlined" severity="warning">
            <AlertTitle>No server Connection</AlertTitle>
            The server seems to be down, please try again later.
          </Alert>
        </Dialog>
        <Dialog
          open={showNoBalance}
          hideBackdrop
          onClose={() => setShowNoBalance(false)}
        >
          <Alert variant="outlined" severity="warning">
            <AlertTitle>Your balance is zero</AlertTitle>A minumum of{" "}
            {showAmount + 1} LTO is required to build a ownable.
          </Alert>
        </Dialog>
        <Dialog
          open={lowBalance}
          hideBackdrop
          onClose={() => setLowBalance(false)}
        >
          <Alert variant="outlined" severity="warning">
            <AlertTitle>
              Your balance is to low. A A minumum of {showAmount + 1} LTO is
              required to build a ownable.{" "}
            </AlertTitle>
            Please top up.
          </Alert>
        </Dialog>
        <Dialog open={openDialog} onClose={handleCloseDialog}>
          <DialogTitle>Ownable Sent</DialogTitle>
          <DialogContent>
            <DialogContentText>
              The ownable has been successfully sent.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose} color="primary">
              Close
            </Button>
          </DialogActions>
        </Dialog>
      </Dialog>
    </>
  );
}
