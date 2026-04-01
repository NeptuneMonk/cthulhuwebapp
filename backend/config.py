import os
import hashlib
from dotenv import load_dotenv

load_dotenv()

P2FK_API_BASE = "https://p2fk.io"
MEMPOOL_TESTNET_API = "https://mempool.space/testnet/api"
MEMPOOL_MAINNET_API = "https://mempool.space/api"

# Auth
MONGO_URL = os.environ.get('MONGO_URL', '')
JWT_SECRET = os.environ.get('JWT_SECRET', hashlib.sha256(MONGO_URL.encode()).hexdigest())
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 30

# P2FK protocol
P2FK_DELIMITERS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|']
BASE58_DIGITS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

# Dust values that indicate P2FK-encoded outputs (in satoshis)
P2FK_DUST_VALUES_SAT = {1, 546, 548, 550, 1000, 5480, 5500, 1000000, 2000000, 100000000}

# Chain API endpoints
CHAIN_TX_APIS = {
    'BTC': {
        'mainnet': [
            {'url': 'https://blockstream.info/api/tx/{txid}', 'parser': 'mempool'},
            {'url': 'https://mempool.space/api/tx/{txid}', 'parser': 'mempool'},
        ],
        'testnet': [
            {'url': 'https://blockstream.info/testnet/api/tx/{txid}', 'parser': 'mempool'},
            {'url': 'https://mempool.space/testnet/api/tx/{txid}', 'parser': 'mempool'},
        ],
    },
    'LTC': {
        'mainnet': [{'url': 'https://litecoinspace.org/api/tx/{txid}', 'parser': 'mempool'}],
    },
    'DOG': {
        'mainnet': [
            {'url': 'https://api.blockcypher.com/v1/doge/main/txs/{txid}?limit=500', 'parser': 'blockcypher'},
            {'url': 'https://api.blockchair.com/dogecoin/raw/transaction/{txid}', 'parser': 'blockchair'},
        ],
    },
    'DOGE': {
        'mainnet': [
            {'url': 'https://api.blockcypher.com/v1/doge/main/txs/{txid}?limit=500', 'parser': 'blockcypher'},
            {'url': 'https://api.blockchair.com/dogecoin/raw/transaction/{txid}', 'parser': 'blockchair'},
        ],
    },
    'MZC': {
        'mainnet': [
            {'url': 'https://mazacha.in/api/getrawtransaction?txid={txid}&decrypt=1', 'parser': 'mazachain'},
        ],
    },
    'POT': {},
}

# Address version byte → (chain, is_mainnet) mapping
# Used to detect which blockchain a transaction belongs to from its output addresses.
# This mirrors the SUP reference client's byte mapping approach.
ADDRESS_VERSION_CHAINS = {
    0x00: ('BTC', True),   # BTC mainnet (addresses start with '1')
    0x6F: ('BTC', False),  # BTC testnet (addresses start with 'm' or 'n')
    0x30: ('LTC', True),   # LTC mainnet (addresses start with 'L')
    0x1E: ('DOG', True),   # DOGE mainnet (addresses start with 'D')
    0x32: ('MZC', True),   # MZC mainnet (addresses start with 'M')
}

# MIME type mapping
EXTENSION_MIME = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
    'bmp': 'image/bmp', 'ico': 'image/x-icon',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
    'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'text/javascript', 'json': 'application/json',
    'pdf': 'application/pdf', 'zip': 'application/zip',
    'txt': 'text/plain', 'xml': 'application/xml',
}

# Treasury (platform fee collection)
TREASURY_TESTNET_WIF = os.environ.get('TREASURY_TESTNET_WIF', '')
TREASURY_MAINNET_WIF = os.environ.get('TREASURY_MAINNET_WIF', '')
TREASURY_MAINNET_ADDRESS = os.environ.get('TREASURY_MAINNET_ADDRESS', '')
TREASURY_TAX_RATE = 0.02  # 2%
TREASURY_FAUCET_AMOUNT = 15000  # sats to send new testnet users

SEED_ADDRESSES = {
    'btc-mainnet': [
        '19yMYv9hRRG7tD36eFHPoFeaA2x82CrcGC',
        '1AFJHYBkdzXbFiHgPSRquYB6P2DdbdnrYB',
        '16rb9yA7FYQPTUpwZJsWZV77fWUUGsfGpw',
        '1BXVPoJUtjJhYPiPNx2SyimTJo7YZmmn1J',
        '1A4q2oywacE8LjCyi1gjAcFmQt7ZYNyZ9M',
        '1Dn5LkuWVYp4VR8HyfDvibBEogHBQeX8BN',
        '1ELTYFMgeraj228Tx5WEdKPZH7ttoSZ2s6',
        '1JMe3WfKVR4w6U5uxmvtLT7xfiwYXGHBZm',
        '1Fr9YXYeT3anhBA9LPjNxLCBVnJ4EFzrUX',
    ],
    'btc-testnet': [
        'muVrFVk3ErfrnmWosLF4WixxRtDKfMx9bs',
        'mr3SgrPThkjxKWC16WzpodynAniFUvprSJ',
        'mpVJqyEgEShNfKWiMpFmdAru22YpsaQwe8',
        'mpmFabGjT1xr2pmJ71QDjTPRF1pLUrdKGm',
        'mr8QDF9fSfusDCPeGvsUVi3P3V6RD47uGS',
        'mhcsX1bxHGrwJSRNgN97QVjUCXdizQxNTC',
        'mxyo2qyUo9h7wzDYbudcyC2VWxaTfTeCZr',
        'mz8uM6AvZYbABhMW7nuz48Fd2UEBXNpMJF',
        'n1rrZbg1WzDg5kNKho6zTsvcutjYiFMZWY',
        'muVaP8uXDSVbLb5h78QRoUrkzfgCvX4YFg',
        'myUZK1mYmZSfrMtNBGRZLpT9miFUpnYsMk',
        'mpB1oS5XPASsqb7JpJQJqJqGzWz1TKYjba',
        'n1G7h7g7oPLt8cvHwWqUnJfnty4kPsTG7t',
        'mn3Yx4rebGSbKqcZNK7En3wyDeGrgNsetS',
        'mxTRJW1B4iQS4mwq1gnoCymR2W68uBCaH4',
        'msWMpf5y7m3zywvn4W8oy27TxEWMthZxXx',
        'ms5CdjpAHNuSGjq6UUxawJwAiDmQxjwKRH',
        'mk3u7c8CiAcZjZNhucsbddEtWYocHHhg75',
        'n47nXPsq1UvF2GGfKgggpBknwqzg8Vjn9L',
        'mxbQegyFdwY8vJtXSMKLJENtTKgax5CUhv',
        'mjpNY9thq8u62RNnfwPom8ydtuihnMmxbM',
        'n4N5eASY9hZc8xX13G3iMJHR9jadVEnvsp',
        'n4H2nSNY62H1aMt9VmsoDNn7NNV9CDtpvc',
        'min92tprFRwLLknBKbLiJ5udFbD4eUymJA',
        'mzPtJQgAqDpq9JxkY8zZFV7bRHKm1ejxgH',
        'mrGnvf7baTvjA8E41VNMosFUpVgPWMz8j4',
        'n3stdRLgoDE5ScNEqsgJLvxYCoFi3n7G2J',
        'mgpxF9NcJb9EzD2xuxtNaAajGutmE8yVu8',
        'miTbc89ebMnfEHqcKgNmnM32HNzzVeBZPM',
        'mhUeXQsPcFWXVk6aypCcBw1wnFjyvAho1c',
        'mkhJazrryvMqmfrfWz2yLadc3SaYrjWZnT',
        'n3EhJwVEowoWgezmf6nECptqmDtEwRw8Hy',
        'n24TUwmpQXjbm1HZEVWfbrJx9qNFMnCRQS',
        'mgZqD6kyu1GGst8TqaFJa4wCqH1wE6GJuJ',
        'mu9fLWpKCoDm9iZnTzdEVmMzijA4hMVHs6',
        'mkhnN3WD7PjVwS1etdnEDV4R6boqrwRgpz',
        'n1GxUkaptXxKg3PEetBdrDBJccHBUtsGDZ',
        'mqQ6KhpU7hPVh2TFiCwNeDgArWzCxXtTmF',
        'mo3eTXrJsWoWjxkYnRdKYGGCKFao2V3b6f',
        'mu4rvwx26X64oj6xyLM6hsQhpXJWwMhpox',
        'mufggR9bkZj8C3LxyKqEdqrvpn4hX4iT2N',
        'mpsP1uKsSDF2L7ooN7tvJmLqz7ZAnggLPw',
        'ms2MYw2uW9keCzv3ZPRhUKrCuKHxdiWAuw',
        'n3NmoAwixm12zScdmxPq2yFzyH5RuN4Quy',
        'my1UuxYFdGWjNHPPfi63rM7mN582DorhdR',
        'mk3tYVdhhuA1pYUou4FEHW5egAkzauPMRu',
        'mzJzNsn5WxYd4wo687E1vKQyGPT4ejCnL2',
        'mr7bX7qyQcTeordoUUZDR9cVy5RcRtmU6S',
        'n1JGt8c3hssyemFRefGpbe9nwdx4sY2eB4',
        'mvnvLnqJqf3vo7BFWxe5dMLcrK1XQKU3Xf',
        'mhEkkENa3Na4qCbG6Nw3tro41rbQpWT1JP',
        'mpTRigw1RJW58AH9cWPe2mcKL5LWsa7oGa',
        'miGxynWKyNKd4jLgFhaxsX21vWv8cTcYWv',
        'n4AzBykVYSAsmFeSZiZMMoVpwQeDVdf6bT',
        'n4onSXCB4tepPA4Zqnrv5egxUtagEUL4e1',
    ],
}
