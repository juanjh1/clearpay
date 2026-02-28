import "./style.css";
import * as FreighterApi from "@stellar/freighter-api";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";


import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  Account,
  scValToNative
} from "@stellar/stellar-sdk";

const BACKEND_URL = "https://fibrovascular-ungivable-jayme.ngrok-free.dev";
const RPC_URL = "https://soroban-testnet.stellar.org";
const ATTENDANCE_CONTRACT_ID = "CDNWCHNPVVR6KTXSZJR6V5HPWGAUTCCIQ2UG5JDLY4D3Z37S2NSMHVLM";
const ESCROW_CONTRACT_ID = "CCYYT4JOOKLM6KMW2OV6CFA5UPGCZJ5Q4T5YU2W72EHUOUS3MYA72AHH";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

let publicKey = null;
let currentRole = null;
let currentChallenge = null;
let expiresAt = null;
let scanner = null;
let countdownInterval = null;

// ================= LOGIN =================

let registeredWallet = null;

async function loginUser(email, password) {

  const response = await fetch(`${BACKEND_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();

  if (data.error) {
    alert(data.error);
    return;
  }

  currentRole = data.role;
  registeredWallet = data.registeredWallet; // 🔥 NUEVO

  renderApp();
}

// ================= RENDER =================

function renderApp() {

  document.getElementById("loginSection").style.display = "none";
  document.getElementById("appSection").style.display = "block";

  if (currentRole === "admin") {

    document.getElementById("employerSection").style.display = "block";
    document.getElementById("employeeSection").style.display = "none";

    // 🔥 Cargar todo lo del admin
    loadAdminEmployees();
    loadAdminAttendance();
    loadAdminAssistance();
    loadAdminQR();

    // Mostrar pantalla inicial
    showAdminScreen("employeesScreen");

  } else {

    document.getElementById("employerSection").style.display = "none";
    document.getElementById("employeeSection").style.display = "block";
  }
}

// ================= ADMIN QR =================

async function loadChallenge() {

  const response = await fetch(`${BACKEND_URL}/challenge`);
  const data = await response.json();
  
  currentChallenge = data.challenge;
  expiresAt = data.expires;
  console.log(data)
  const qrCanvas = document.getElementById("qrCanvas");
  const countdownText = document.getElementById("countdown");

  await QRCode.toCanvas(
    qrCanvas,
    JSON.stringify(data)
  );

  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  countdownInterval = setInterval( async ( ) => {

    const now = Math.floor(Date.now() / 1000);
    const remaining = expiresAt - now;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      await loadChallenge(); // genera uno nuevo automáticamente
    } else {
      countdownText.innerText = "Expira en: " + remaining + " segundos";
    }

  }, 1000);
}

// ================= SCANNER =================

function startScanner() {

  const readerDiv = document.getElementById("reader");
  const scanStatus = document.getElementById("scanStatus");

  readerDiv.style.display = "block";
  scanStatus.innerText = "Abriendo cámara...";

  scanner = new Html5Qrcode("reader");

  Html5Qrcode.getCameras().then(devices => {

    if (!devices || devices.length === 0) {
      scanStatus.innerText = "No se encontró cámara.";
      return;
    }

    scanner.start(
      devices[0].id,
      { fps: 10, qrbox: 250 },
      (decodedText) => {

        const parsed = JSON.parse(decodedText);

        currentChallenge = parsed.challenge;
        expiresAt = parsed.expires;

        scanStatus.innerText = "QR escaneado correctamente.";

        scanner.stop();
        readerDiv.style.display = "none";
      }
    );
  });
}




// ================= Look escrow contract =================

async function getEscrowData(employeeWallet) {

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const operation = contract.call(
    "get_escrow",
    new Address(employeeWallet).toScVal()
  );

  const rpcAccount = await server.getAccount(publicKey);
  const dummyAccount = new Account(publicKey, String(rpcAccount.sequence));

  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(0)
    .build();

  try {

    const simulated = await server.simulateTransaction(tx);

    if (!simulated.result?.retval) return null;

    const escrow = scValToNative(simulated.result.retval);

    return escrow;

  } catch (err) {
    return null; // no escrow
  }
}

async function getEscrowBalance() {

  const server = new rpc.Server(RPC_URL);

  const tokenContract = new Contract("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");

  const operation = tokenContract.call(
    "balance",
    new Address(ESCROW_CONTRACT_ID).toScVal()
  );

  const dummy = new Account(ESCROW_CONTRACT_ID, "0");

  const tx = new TransactionBuilder(dummy, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(0)
    .build();

  const simulated = await server.simulateTransaction(tx);

  if (!simulated.result?.retval) return 0;

  return Number(scValToNative(simulated.result.retval));
}

// ================= CHECK-IN / CHECK-OUT =================

async function submitTransaction(functionName) {

  if (!publicKey) {
    alert("Conecta wallet primero.");
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  if (!currentChallenge || now > expiresAt) {
    alert("Escanea un QR válido.");
    return;
  }

  const nonceBytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(currentChallenge + publicKey)
    )
  );

  const server = new rpc.Server(RPC_URL);
  const rpcAccount = await server.getAccount(publicKey);

  const account = new Account(publicKey, String(rpcAccount.sequence));
  const contract = new Contract(ATTENDANCE_CONTRACT_ID);

  const operation = contract.call(
    functionName,
    new Address(publicKey).toScVal(),
    nativeToScVal(nonceBytes, { type: "bytes" })
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulated).build();

  const signed = await FreighterApi.signTransaction(
    tx.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  await server.sendTransaction(
    TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      NETWORK_PASSPHRASE
    )
  );

  loadAttendanceHistory();
}

// ================= HISTORIAL =================

async function loadAttendanceHistory() {

  if (!publicKey) return;

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ATTENDANCE_CONTRACT_ID);

  const now = new Date();
  const currentDayEpoch = Math.floor(Date.now() / 1000 / 86400);

  // 🔥 Obtener lunes de esta semana
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = domingo
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);

  // 🔥 Primer día del mes
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const tableBody = document.getElementById("attendanceTableBody");
  tableBody.innerHTML = "";

  let totalWeek = 0;
  let totalMonth = 0;
  let totalAccumulated = 0;

  for (let i = 0; i < 30; i++) {

    const dayEpoch = currentDayEpoch - i;

    const operation = contract.call(
      "get_attendance",
      new Address(publicKey).toScVal(),
      nativeToScVal(dayEpoch, { type: "u64" })
    );

    const account = new Account(publicKey, "0");

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(0)
      .build();

    const simulated = await server.simulateTransaction(tx);

    if (!simulated.result?.retval) continue;

    const attendance = scValToNative(simulated.result.retval);
    if (!attendance) continue;

    let checkIn = attendance.check_in;
    let checkOut = attendance.check_out;

    if (!checkIn || !checkOut) continue;

    checkIn = Number(checkIn);
    checkOut = Number(checkOut);

    const hours = (checkOut - checkIn) / 3600;
    totalAccumulated += hours;

    const dateObj = new Date(dayEpoch * 86400 * 1000);

    // 🔥 Semana calendario real
    if (dateObj >= monday) {
      totalWeek += hours;
    }

    // 🔥 Mes calendario real
    if (dateObj >= firstDayOfMonth) {
      totalMonth += hours;
    }

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${dateObj.toLocaleDateString()}</td>
      <td>${new Date(checkIn * 1000).toLocaleString()}</td>
      <td>${new Date(checkOut * 1000).toLocaleString()}</td>
      <td>${hours.toFixed(2)}</td>
    `;

    tableBody.appendChild(row);
  }

  document.getElementById("totalWeek").innerText = totalWeek.toFixed(2);
  document.getElementById("totalMonth").innerText = totalMonth.toFixed(2);
  document.getElementById("totalAccumulated").innerText = totalAccumulated.toFixed(2);
}

async function loadEmployeeEscrow() {

  if (!publicKey) return;

  const amountElement = document.getElementById("payrollAmount");
  const statusElement = document.getElementById("payrollStatus");
  const cardElement = document.getElementById("payrollCard");

  const escrow = await getEscrowData(publicKey);

  // Reset visual
  cardElement.style.backgroundColor = "#f4f4f4";
  statusElement.style.color = "#666";

  if (!escrow) {
    amountElement.innerText = "-";
    statusElement.innerText = "No Escrow Created";
    return;
  }

  const amount = Number(escrow.amount) / 10000000;
  amountElement.innerText = "$" + amount;

  if (escrow.state === "Active") {
    statusElement.innerText = "Escrow Active";
    statusElement.style.color = "green";
    cardElement.style.backgroundColor = "#e8f5e9";
  }

  else if (escrow.state === "Released") {
    statusElement.innerText = "Already Paid";
    statusElement.style.color = "#1565c0";
    cardElement.style.backgroundColor = "#e3f2fd";
    amountElement.innerText = "$" + amount + " (Paid)";
  }

  else if (escrow.state === "Disputed") {
    statusElement.innerText = "In Dispute";
    statusElement.style.color = "#ef6c00";
    cardElement.style.backgroundColor = "#fff3e0";
  }

  else if (escrow.state === "Refunded") {
    statusElement.innerText = "Refunded";
    statusElement.style.color = "#c62828";
    cardElement.style.backgroundColor = "#ffebee";
  }

  const claimBtn = document.getElementById("claimBtn");
  claimBtn.disabled = false;
}

// ================= DOM READY =================


window.addEventListener("DOMContentLoaded", () => {

  document.getElementById("loginBtn").onclick = () => {
    loginUser(loginEmail.value, loginPassword.value);
  };

  document.getElementById("claimBtn")
    .addEventListener("click", claimEscrowOnChain);

  document.getElementById("addManualHoursBtn")
    .addEventListener("click", addManualHoursOnChain);

  document.getElementById("openDisputeBtn")
    .addEventListener("click", openDisputeOnChain);

  document.getElementById("resolveToEmployeeBtn")
    .addEventListener("click", () => resolveDisputeOnChain(true));

  document.getElementById("resolveToEmployerBtn")
    .addEventListener("click", () => resolveDisputeOnChain(false));

  document.getElementById("createEscrowBtn")
    .addEventListener("click", createEscrowOnChain);

  document.getElementById("fundEscrowBtn")
    .addEventListener("click", fundEscrow);

  // Admin sidebar navigation
  document.querySelectorAll(".admin-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const screenId = btn.getAttribute("data-screen");
      showAdminScreen(screenId);
    });
  });

  document.getElementById("logoutBtn").onclick = () => {

    // Reset variables
    publicKey = null;
    currentRole = null;
    registeredWallet = null;
    currentChallenge = null;
    expiresAt = null;

    // Limpiar wallet visible
    document.getElementById("wallet").innerText = "";

    // Reset payroll card si existe
    const amount = document.getElementById("payrollAmount");
    const status = document.getElementById("payrollStatus");
    const card = document.getElementById("payrollCard");

    if (amount) amount.innerText = "-";
    if (status) status.innerText = "No Escrow";
    if (card) card.style.backgroundColor = "#f4f4f4";

    // Reset secciones
    document.getElementById("appSection").style.display = "none";
    document.getElementById("loginSection").style.display = "flex";
  };

  document.getElementById("registerBtn").onclick = async () => {

    const response = await fetch(`${BACKEND_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: registerEmail.value,
        password: registerPassword.value,
        role: registerRole.value,
        wallet: registerWallet.value   // 🔥 NUEVO
      })
    });

    const data = await response.json();

    if (data.error) {
      alert(data.error);
      return;
    }

    alert("Registered successfully.");
  };

  document.getElementById("connectBtn").onclick = async () => {

    const access = await FreighterApi.requestAccess();
    const connectedWallet = access.address;

    if (currentRole === "employee") {

      if (connectedWallet !== registeredWallet) {
        alert("This wallet is not associated with your account.");
        return;
      }
    }

    publicKey = connectedWallet;

    document.getElementById("wallet").innerText =
      publicKey.slice(0, 6) + "..." + publicKey.slice(-4);

    if (currentRole === "employee") {
      loadAttendanceHistory();
      loadEmployeeEscrow();
    }
  };

  document.getElementById("createEmployeeBtn")
  .addEventListener("click", () => {

    const wallet = document
      .getElementById("newEmployeeWallet")
      .value
      .trim();

    if (!wallet.startsWith("G")) {
      alert("Invalid Stellar address.");
      return;
    }

    registerEmployeeOnChain(wallet);
  });

  document.getElementById("startScanBtn").onclick =
    () => startScanner();

  document.getElementById("checkInBtn").onclick =
    () => submitTransaction("check_in");

  document.getElementById("checkOutBtn").onclick =
    () => submitTransaction("check_out");
});




// ================= Sidebar employer =================

function showAdminScreen(screenId) {

  const screens = document.querySelectorAll(".admin-screen");
  const buttons = document.querySelectorAll(".admin-nav-btn");

  screens.forEach(screen => {
    screen.style.display = "none";
  });

  buttons.forEach(btn => {
    btn.classList.remove("active");
  });

  document.getElementById(screenId).style.display = "block";

  document.querySelector(`[data-screen="${screenId}"]`)
    .classList.add("active");
}

async function loadAdminEmployees() {

  const response = await fetch(`${BACKEND_URL}/admin/employees`);
  const employees = await response.json();

  const table = document.getElementById("adminEmployeesTable");
  table.innerHTML = "";

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ATTENDANCE_CONTRACT_ID);

  const today = new Date();
  const currentDayEpoch = Math.floor(Date.now() / 1000 / 86400);

  const dayOfWeek = today.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  for (const emp of employees) {

    let totalWeek = 0;
    let totalMonth = 0;

    // ================= CALCULAR HORAS =================
    for (let i = 0; i < 30; i++) {

      const dayEpoch = currentDayEpoch - i;

      const operation = contract.call(
        "get_attendance",
        new Address(emp.wallet).toScVal(),
        nativeToScVal(dayEpoch, { type: "u64" })
      );

      const account = new Account(emp.wallet, "0");

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE
      })
        .addOperation(operation)
        .setTimeout(0)
        .build();

      const simulated = await server.simulateTransaction(tx);

      if (!simulated.result?.retval) continue;

      const attendance = scValToNative(simulated.result.retval);
      if (!attendance) continue;
      if (!attendance.check_in || !attendance.check_out) continue;

      const checkIn = Number(attendance.check_in);
      const checkOut = Number(attendance.check_out);
      const hours = (checkOut - checkIn) / 3600;

      const dateObj = new Date(dayEpoch * 86400 * 1000);

      if (dateObj >= monday) totalWeek += hours;
      if (dateObj >= firstDayOfMonth) totalMonth += hours;
    }

    // ================= NUEVO: CONSULTAR ESCROW =================

    const escrow = await getEscrowData(emp.wallet);

    let escrowAmount = "-";
    let escrowStatus = "No Escrow";

    if (escrow) {

      escrowAmount = Number(escrow.amount) / 10000000;

      if (escrow.state === "Active") escrowStatus = "Active";
      else if (escrow.state === "Released") escrowStatus = "Released";
      else if (escrow.state === "Disputed") escrowStatus = "Disputed";
      else if (escrow.state === "Refunded") escrowStatus = "Refunded";
    }

    // ================= CREAR FILA =================

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${emp.email}</td>
      <td>${totalWeek.toFixed(2)}</td>
      <td>${totalMonth.toFixed(2)}</td>
      <td>${escrowAmount}</td>
      <td>${escrowStatus}</td>
    `;

    table.appendChild(row);
  }
}

async function loadAdminAttendance() {

  const response = await fetch(`${BACKEND_URL}/admin/employees`);
  const employees = await response.json();

  const table = document.getElementById("adminAttendanceTable");
  table.innerHTML = "";

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ATTENDANCE_CONTRACT_ID);

  const currentDayEpoch = Math.floor(Date.now() / 1000 / 86400);

  for (const emp of employees) {

    for (let i = 0; i < 14; i++) {  // últimos 14 días

      const dayEpoch = currentDayEpoch - i;

      const operation = contract.call(
        "get_attendance",
        new Address(emp.wallet).toScVal(),
        nativeToScVal(dayEpoch, { type: "u64" })
      );

      const account = new Account(emp.wallet, "0");

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE
      })
        .addOperation(operation)
        .setTimeout(0)
        .build();

      const simulated = await server.simulateTransaction(tx);

      if (!simulated.result?.retval) continue;

      const attendance = scValToNative(simulated.result.retval);
      if (!attendance) continue;
      if (!attendance.check_in || !attendance.check_out) continue;

      const checkIn = Number(attendance.check_in);
      const checkOut = Number(attendance.check_out);
      const hours = (checkOut - checkIn) / 3600;

      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${emp.wallet.slice(0,6)}...</td>
        <td>${emp.email}</td>
        <td>${new Date(checkIn * 1000).toLocaleString()}</td>
        <td>${new Date(checkOut * 1000).toLocaleString()}</td>
        <td>${hours.toFixed(2)}</td>
      `;

      table.appendChild(row);
    }
  }
}

let adminQrInterval = null;

async function loadAdminQR() {

  const response = await fetch(`${BACKEND_URL}/challenge`);
  const data = await response.json();

  const canvas = document.getElementById("qrCanvasAdmin");

  await QRCode.toCanvas(canvas, JSON.stringify(data));

  const expires = data.expires;

  if (adminQrInterval) clearInterval(adminQrInterval);

  adminQrInterval = setInterval(() => {

    const now = Math.floor(Date.now() / 1000);
    const remaining = expires - now;

    if (remaining <= 0) {
      clearInterval(adminQrInterval);
      loadAdminQR();
    } else {
      document.getElementById("adminQrCountdown").innerText =
        `Expires in: ${remaining} seconds`;
    }

  }, 1000);
}

async function loadAdminAssistance() {

  const response = await fetch(`${BACKEND_URL}/admin/comments`);
  const comments = await response.json();

  const table = document.getElementById("adminAssistanceTable");
  table.innerHTML = "";

  if (!comments.length) {
    table.innerHTML = `<tr><td colspan="3">No requests yet</td></tr>`;
    return;
  }

  for (const c of comments) {

    const date = new Date(c.timestamp * 1000).toLocaleString();

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${date}</td>
      <td>${c.email}</td>
      <td>${c.comment || "-"}</td>
    `;

    table.appendChild(row);
  }
}

async function registerEmployeeOnChain(walletAddress) {

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ATTENDANCE_CONTRACT_ID);

  const adminAddress = publicKey;

  if (!adminAddress) {
    alert("Connect admin wallet first.");
    return;
  }

  try {

    const rpcAccount = await server.getAccount(adminAddress);
    const account = new Account(adminAddress, String(rpcAccount.sequence));

    const operation = contract.call(
      "register_employee",
      nativeToScVal(walletAddress, { type: "address" })   // ✅ FIX REAL
    );

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(tx);
    tx = rpc.assembleTransaction(tx, simulated).build();

    const signed = await FreighterApi.signTransaction(
      tx.toXDR(),
      { networkPassphrase: NETWORK_PASSPHRASE }
    );

    await server.sendTransaction(
      TransactionBuilder.fromXDR(
        signed.signedTxXdr,
        NETWORK_PASSPHRASE
      )
    );

    document.getElementById("createEmployeeStatus").innerText =
      "Employee successfully registered on-chain.";

  } catch (err) {
    console.error(err);
    document.getElementById("createEmployeeStatus").innerText =
      "Error registering employee.";
  }
}

// ================= Crear Escrow y Fondearlo =================

async function createEscrowOnChain() {

  if (!publicKey) {
    alert("Connect admin wallet first.");
    return;
  }

  const employee = document.getElementById("escrowEmployeeWallet").value.trim();
  const amountInput = document.getElementById("escrowAmount").value;
  const requiredHours = document.getElementById("escrowRequiredHours").value;
  const resolver = document.getElementById("escrowResolverWallet").value.trim();

  if (!resolver.startsWith("G")) {
    alert("Invalid resolver wallet.");
    return;
  }

  if (!employee.startsWith("G")) {
    alert("Invalid employee wallet.");
    return;
  }

  const amount = Number(amountInput) * 10000000;

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const rpcAccount = await server.getAccount(publicKey);
  const account = new Account(publicKey, String(rpcAccount.sequence));

  const operation = contract.call(
    "create_escrow",
    new Address(publicKey).toScVal(),
    new Address(employee).toScVal(),
    new Address(ATTENDANCE_CONTRACT_ID).toScVal(),
    new Address(publicKey).toScVal(),
    new Address(publicKey).toScVal(),
    new Address("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC").toScVal(),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(Number(requiredHours), { type: "u64" })
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulated).build();

  const signed = await FreighterApi.signTransaction(
    tx.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  await server.sendTransaction(
    TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      NETWORK_PASSPHRASE
    )
  );

  document.getElementById("createEscrowStatus").innerText =
    "Escrow created successfully.";
}

async function fundEscrow() {

  if (!publicKey) {
    alert("Connect admin wallet first.");
    return;
  }

  const amountInput = document.getElementById("escrowAmount").value;
  const amount = Number(amountInput) * 10000000;

  const server = new rpc.Server(RPC_URL);
  const tokenContract = new Contract("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");

  const rpcAccount = await server.getAccount(publicKey);
  const account = new Account(publicKey, String(rpcAccount.sequence));

  const operation = tokenContract.call(
    "transfer",
    new Address(publicKey).toScVal(),
    new Address(ESCROW_CONTRACT_ID).toScVal(),
    nativeToScVal(amount, { type: "i128" })
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulated).build();

  const signed = await FreighterApi.signTransaction(
    tx.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  await server.sendTransaction(
    TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      NETWORK_PASSPHRASE
    )
  );

  document.getElementById("createEscrowStatus").innerText =
    "Escrow funded successfully.";
}


// ================= Manejar Escrow =================

async function addManualHoursOnChain() {

  const employee = document.getElementById("manageEmployeeWallet").value.trim();
  const hours = Number(document.getElementById("manualHoursInput").value);

  if (!publicKey) return alert("Connect wallet first");
  if (!employee.startsWith("G")) return alert("Invalid employee wallet");

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const rpcAccount = await server.getAccount(publicKey);
  const account = new Account(publicKey, String(rpcAccount.sequence));

  const operation = contract.call(
    "add_manual_hours",
    new Address(publicKey).toScVal(),
    new Address(employee).toScVal(),
    nativeToScVal(hours, { type: "u64" })   // 🔥 importante
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulated).build();

  const signed = await FreighterApi.signTransaction(
    tx.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  await server.sendTransaction(
    TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      NETWORK_PASSPHRASE
    )
  );

  document.getElementById("manageEscrowStatus").innerText =
    "Manual hours added successfully.";
}

async function openDisputeOnChain() {

  const employee = document.getElementById("manageEmployeeWallet").value.trim();

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const rpcAccount = await server.getAccount(publicKey);
  const account = new Account(publicKey, String(rpcAccount.sequence));

  const operation = contract.call(
    "open_dispute",
    new Address(publicKey).toScVal(),
    new Address(employee).toScVal()
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulated).build();

  const signed = await FreighterApi.signTransaction(
    tx.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  await server.sendTransaction(
    TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      NETWORK_PASSPHRASE
    )
  );

  document.getElementById("manageEscrowStatus").innerText =
    "Dispute opened.";
}

async function resolveDisputeOnChain(releaseToEmployee) {

  const employee = document.getElementById("manageEmployeeWallet").value.trim();

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const rpcAccount = await server.getAccount(publicKey);
  const account = new Account(publicKey, String(rpcAccount.sequence));

  const operation = contract.call(
    "resolve_dispute",
    new Address(publicKey).toScVal(),
    new Address(employee).toScVal(),
    nativeToScVal(releaseToEmployee, { type: "bool" })
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulated).build();

  const signed = await FreighterApi.signTransaction(
    tx.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  await server.sendTransaction(
    TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      NETWORK_PASSPHRASE
    )
  );

  document.getElementById("manageEscrowStatus").innerText =
    "Dispute resolved.";
}

// ================= Claimear escrow =================

async function claimEscrowOnChain() {

  if (!publicKey) return alert("Connect wallet first");

  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const rpcAccount = await server.getAccount(publicKey);
  const account = new Account(publicKey, String(rpcAccount.sequence));

  const operation = contract.call(
    "claim",
    new Address(publicKey).toScVal()   // employee
  );

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulated).build();

  const signed = await FreighterApi.signTransaction(
    tx.toXDR(),
    { networkPassphrase: NETWORK_PASSPHRASE }
  );

  await server.sendTransaction(
    TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      NETWORK_PASSPHRASE
    )
  );

  document.getElementById("payrollStatus").innerText = "Claim Successful";
  document.getElementById("claimBtn").disabled = true;

  await loadEmployeeEscrow();  // refresca estado
}
