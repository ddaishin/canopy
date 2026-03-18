use crate::state::{AppState, Provider, ProviderSettings};
use tauri::State;

const KEYRING_SERVICE: &str = "canopy";

const ALLOWED_KEYRING_KEYS: &[&str] = &[
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_session_token",
];

fn validate_keyring_key(key: &str) -> Result<(), String> {
    if !ALLOWED_KEYRING_KEYS.contains(&key) {
        return Err(format!("Invalid keyring key: {}", key));
    }
    Ok(())
}

#[tauri::command]
pub fn save_keyring_secret(key: String, value: String) -> Result<(), String> {
    validate_keyring_key(&key)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Keyring error: {}", e))?;
    entry
        .set_password(&value)
        .map_err(|e| format!("Failed to save secret: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_keyring_secret(key: String) -> Result<Option<String>, String> {
    validate_keyring_key(&key)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Keyring error: {}", e))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read secret: {}", e)),
    }
}

#[tauri::command]
pub fn delete_keyring_secret(key: String) -> Result<(), String> {
    validate_keyring_key(&key)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key)
        .map_err(|e| format!("Keyring error: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete secret: {}", e)),
    }
}

#[tauri::command]
pub fn update_provider_cache(
    state: State<'_, AppState>,
    provider: String,
    aws_region: Option<String>,
    aws_profile: Option<String>,
    gcp_project_id: Option<String>,
    gcp_region: Option<String>,
    model_override: Option<String>,
) -> Result<(), String> {
    let prov = match provider.as_str() {
        "bedrock" => Provider::Bedrock,
        "vertex" => Provider::Vertex,
        _ => Provider::Direct,
    };

    let read_secret = |key: &str| -> Option<String> {
        keyring::Entry::new(KEYRING_SERVICE, key)
            .ok()
            .and_then(|e| e.get_password().ok())
    };

    let settings = ProviderSettings {
        provider: prov,
        aws_region,
        aws_profile,
        aws_access_key_id: read_secret("aws_access_key_id"),
        aws_secret_access_key: read_secret("aws_secret_access_key"),
        aws_session_token: read_secret("aws_session_token"),
        gcp_project_id,
        gcp_region,
        model_override,
    };

    let mut cache = state
        .provider_settings
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    *cache = Some(settings);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_keyring_key_allows_valid_keys() {
        assert!(validate_keyring_key("aws_access_key_id").is_ok());
        assert!(validate_keyring_key("aws_secret_access_key").is_ok());
        assert!(validate_keyring_key("aws_session_token").is_ok());
    }

    #[test]
    fn validate_keyring_key_rejects_invalid_keys() {
        assert!(validate_keyring_key("arbitrary_key").is_err());
        assert!(validate_keyring_key("").is_err());
        assert!(validate_keyring_key("password").is_err());
        assert!(validate_keyring_key("api_key").is_err());
        assert!(validate_keyring_key("../etc/passwd").is_err());
    }

    #[test]
    fn validate_keyring_key_error_message_includes_key() {
        let err = validate_keyring_key("bad_key").unwrap_err();
        assert!(err.contains("bad_key"));
        assert!(err.contains("Invalid keyring key"));
    }

    #[test]
    fn allowed_keys_list_has_exactly_three_entries() {
        // Guard against accidental expansion of the allowlist
        assert_eq!(ALLOWED_KEYRING_KEYS.len(), 3);
    }
}

