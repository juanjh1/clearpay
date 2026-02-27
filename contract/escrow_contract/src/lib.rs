#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    Address, Env, Symbol, IntoVal, BytesN
};

use soroban_sdk::token::Client as TokenClient;

#[contract]
pub struct EscrowContract;

// =====================================================
// ESTRUCTURAS
// =====================================================

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum EscrowState {
    Active,
    Disputed,
    Released,
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct Escrow {
    pub employer: Address,
    pub employee: Address,
    pub attendance_contract: Address,
    pub dispute_resolver: Address,
    pub parafiscales_wallet: Address,
    pub token_contract: Address,
    pub amount: i128,
    pub required_hours: u64,
    pub manual_extra_hours: u64,
    pub state: EscrowState,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(Address),
}

// ⚠️ EXACTAMENTE igual al contrato Attendance
#[contracttype]
#[derive(Clone)]
pub struct Attendance {
    pub check_in: Option<u64>,
    pub check_out: Option<u64>,
    pub check_in_nonce: Option<BytesN<32>>,
    pub check_out_nonce: Option<BytesN<32>>,
}

// =====================================================
// IMPLEMENTACIÓN
// =====================================================

#[contractimpl]
impl EscrowContract {

    // -------------------------------------------------
    // Crear escrow
    // -------------------------------------------------
    pub fn create_escrow(
        env: Env,
        employer: Address,
        employee: Address,
        attendance_contract: Address,
        dispute_resolver: Address,
        parafiscales_wallet: Address,
        token_contract: Address,
        amount: i128,
        required_hours: u64,
    ) {

        employer.require_auth();

        let escrow = Escrow {
            employer: employer.clone(),
            employee: employee.clone(),
            attendance_contract,
            dispute_resolver,
            parafiscales_wallet,
            token_contract,
            amount,
            required_hours,
            manual_extra_hours: 0,
            state: EscrowState::Active,
        };

        env.storage()
            .instance()
            .set(&DataKey::Escrow(employee), &escrow);
    }

    // -------------------------------------------------
    // Agregar horas manuales
    // -------------------------------------------------
    pub fn add_manual_hours(
        env: Env,
        employer: Address,
        employee: Address,
        hours: u64,
    ) {

        employer.require_auth();

        let mut escrow: Escrow = env.storage()
            .instance()
            .get(&DataKey::Escrow(employee.clone()))
            .unwrap();

        if escrow.state != EscrowState::Active {
            panic!("Escrow not active");
        }

        escrow.manual_extra_hours += hours;

        env.storage()
            .instance()
            .set(&DataKey::Escrow(employee), &escrow);
    }

    // -------------------------------------------------
    // Claim automático por horas cumplidas
    // -------------------------------------------------
    pub fn claim(env: Env, employee: Address) {

        employee.require_auth();

        let mut escrow: Escrow = env.storage()
            .instance()
            .get(&DataKey::Escrow(employee.clone()))
            .unwrap();

        if escrow.state != EscrowState::Active {
            panic!("Escrow not claimable");
        }

        let token = TokenClient::new(&env, &escrow.token_contract);

        let balance = token.balance(&env.current_contract_address());

        if balance < escrow.amount {
            panic!("Escrow not funded");
        }

        let total_hours = Self::calculate_hours(
            &env,
            &escrow.attendance_contract,
            &employee,
            escrow.manual_extra_hours,
        );

        if total_hours < escrow.required_hours {
            panic!("Not enough hours");
        }

        let employee_amount = escrow.amount * 95 / 100;
        let para_amount = escrow.amount - employee_amount;

        token.transfer(
            &env.current_contract_address(),
            &escrow.employee,
            &employee_amount,
        );

        token.transfer(
            &env.current_contract_address(),
            &escrow.parafiscales_wallet,
            &para_amount,
        );

        escrow.state = EscrowState::Released;

        env.storage()
            .instance()
            .set(&DataKey::Escrow(employee), &escrow);
    }

    // -------------------------------------------------
    // Abrir disputa
    // -------------------------------------------------
    pub fn open_dispute(env: Env, caller: Address, employee: Address) {

        caller.require_auth();

        let mut escrow: Escrow = env.storage()
            .instance()
            .get(&DataKey::Escrow(employee.clone()))
            .unwrap();

        if caller != escrow.employer && caller != escrow.employee {
            panic!("Not authorized");
        }

        if escrow.state != EscrowState::Active {
            panic!("Cannot dispute");
        }

        escrow.state = EscrowState::Disputed;

        env.storage()
            .instance()
            .set(&DataKey::Escrow(employee), &escrow);
    }

    // -------------------------------------------------
    // Resolver disputa
    // -------------------------------------------------
    pub fn resolve_dispute(
        env: Env,
        resolver: Address,
        employee: Address,
        release_to_employee: bool,
    ) {

        resolver.require_auth();

        let mut escrow: Escrow = env.storage()
            .instance()
            .get(&DataKey::Escrow(employee.clone()))
            .unwrap();

        if resolver != escrow.dispute_resolver {
            panic!("Not dispute resolver");
        }

        if escrow.state != EscrowState::Disputed {
            panic!("No active dispute");
        }

        let token = TokenClient::new(&env, &escrow.token_contract);

        let balance = token.balance(&env.current_contract_address());

        if balance < escrow.amount {
            panic!("Insufficient balance");
        }

        if release_to_employee {
            token.transfer(
                &env.current_contract_address(),
                &escrow.employee,
                &escrow.amount,
            );
            escrow.state = EscrowState::Released;
        } else {
            token.transfer(
                &env.current_contract_address(),
                &escrow.employer,
                &escrow.amount,
            );
            escrow.state = EscrowState::Refunded;
        }

        env.storage()
            .instance()
            .set(&DataKey::Escrow(employee), &escrow);
    }

    // -------------------------------------------------
    // Obtener escrow
    // -------------------------------------------------
    pub fn get_escrow(env: Env, employee: Address) -> Escrow {

        env.storage()
            .instance()
            .get(&DataKey::Escrow(employee))
            .unwrap()
    }

    // -------------------------------------------------
    // Calcular horas (últimos 30 días)
    // -------------------------------------------------
    fn calculate_hours(
        env: &Env,
        attendance_contract: &Address,
        employee: &Address,
        manual: u64,
    ) -> u64 {

        let mut total: u64 = manual;

        let timestamp = env.ledger().timestamp();
        let current_day = timestamp / 86400;

        for i in 0..30u64 {

            if current_day < i {
                break;
            }

            let day = current_day - i;

            let result: Option<Attendance> = env.invoke_contract(
                attendance_contract,
                &Symbol::new(env, "get_attendance"),
                (employee.clone(), day).into_val(env),
            );

            if let Some(att) = result {
                if let (Some(ci), Some(co)) = (att.check_in, att.check_out) {
                    total += (co - ci) / 3600;
                }
            }
        }

        total
    }
}