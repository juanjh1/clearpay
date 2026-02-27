#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    Address, Env, BytesN, symbol_short
};

#[contract]
pub struct AttendanceContract;

// -------------------------------
// ESTRUCTURAS DE DATOS
// -------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Employee(Address),
    Attendance(Address, u64), // (employee, day)
}

#[contracttype]
#[derive(Clone)]
pub struct Attendance {
    pub check_in: Option<u64>,
    pub check_out: Option<u64>,
    pub check_in_nonce: Option<BytesN<32>>,
    pub check_out_nonce: Option<BytesN<32>>,
}

// -------------------------------
// IMPLEMENTACIÓN
// -------------------------------

#[contractimpl]
impl AttendanceContract {

    // -------------------------------
    // Inicializar contrato
    // -------------------------------
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    // -------------------------------
    // Registrar empleado
    // -------------------------------
    pub fn register_employee(env: Env, employee: Address) {

        let admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();

        admin.require_auth();

        env.storage().instance().set(
            &DataKey::Employee(employee.clone()),
            &true
        );
    }

    // -------------------------------
    // Check-In
    // -------------------------------
    pub fn check_in(env: Env, employee: Address, nonce_hash: BytesN<32>) {

        // 1️⃣ El empleado debe firmar
        employee.require_auth();

        // 2️⃣ Verificar que esté registrado
        let registered: bool = env.storage()
            .instance()
            .get(&DataKey::Employee(employee.clone()))
            .unwrap_or(false);

        if !registered {
            panic!("Employee not registered");
        }

        // 3️⃣ Obtener día actual
        let timestamp = env.ledger().timestamp();
        let day = timestamp / 86400;

        let key = DataKey::Attendance(employee.clone(), day);

        let mut record: Attendance = env.storage()
            .instance()
            .get(&key)
            .unwrap_or(Attendance {
                check_in: None,
                check_out: None,
                check_in_nonce: None,
                check_out_nonce: None,
            });

        // 4️⃣ Evitar doble check-in
        if record.check_in.is_some() {
            panic!("Already checked in today");
        }

        // 5️⃣ Guardar datos
        record.check_in = Some(timestamp);
        record.check_in_nonce = Some(nonce_hash.clone());

        env.storage().instance().set(&key, &record);

        // 6️⃣ Emitir evento
        env.events().publish(
            (symbol_short!("checkin"), employee.clone(), day),
            timestamp
        );
    }

    // -------------------------------
    // Check-Out
    // -------------------------------
    pub fn check_out(env: Env, employee: Address, nonce_hash: BytesN<32>) {

        employee.require_auth();

        let registered: bool = env.storage()
            .instance()
            .get(&DataKey::Employee(employee.clone()))
            .unwrap_or(false);

        if !registered {
            panic!("Employee not registered");
        }

        let timestamp = env.ledger().timestamp();
        let day = timestamp / 86400;

        let key = DataKey::Attendance(employee.clone(), day);

        let mut record: Attendance = env.storage()
            .instance()
            .get(&key)
            .unwrap_or(Attendance {
                check_in: None,
                check_out: None,
                check_in_nonce: None,
                check_out_nonce: None,
            });

        // 1️⃣ Debe existir check-in
        if record.check_in.is_none() {
            panic!("Cannot checkout without checkin");
        }

        // 2️⃣ Evitar doble check-out
        if record.check_out.is_some() {
            panic!("Already checked out today");
        }

        record.check_out = Some(timestamp);
        record.check_out_nonce = Some(nonce_hash.clone());

        env.storage().instance().set(&key, &record);

        env.events().publish(
            (symbol_short!("checkout"), employee.clone(), day),
            timestamp
        );
    }

    // -------------------------------
    // Consultar asistencia
    // -------------------------------
    pub fn get_attendance(
        env: Env,
        employee: Address,
        day: u64
    ) -> Option<Attendance> {

        let key = DataKey::Attendance(employee, day);

        env.storage()
            .instance()
            .get(&key)
    }
}
