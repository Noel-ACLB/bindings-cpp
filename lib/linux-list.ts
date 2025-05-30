import { spawn } from 'child_process'
import { PortInfo } from '@noelneu/bindings-interface'
import { ReadlineParser } from '@serialport/parser-readline'
import fs from 'fs'

// get only serial port names
function checkPathOfDevice(path: string) {
  return /(tty(S|WCH|ACM|USB|AMA|MFD|O|XRUSB)|rfcomm)/.test(path) && path
}

function propName(name: string) {
  return {
    DEVNAME: 'path',
    ID_VENDOR_ENC: 'manufacturer',
    ID_SERIAL_SHORT: 'serialNumber',
    ID_VENDOR_ID: 'vendorId',
    ID_MODEL_ID: 'productId',
    ID_MODEL_ENC: 'friendlyName',
    DEVLINKS: 'pnpId',
    /**
    * Workaround for systemd defect
    * see https://github.com/serialport/bindings-cpp/issues/115
    */
    ID_USB_VENDOR_ENC: 'manufacturer',
    ID_USB_SERIAL_SHORT: 'serialNumber',
    ID_USB_VENDOR_ID: 'vendorId',
    ID_USB_MODEL_ID: 'productId',
    // End of workaround
  }[name.toUpperCase()]
}

function decodeHexEscape(str: string) {
  return str.replace(/\\x([a-fA-F0-9]{2})/g, (a, b) => {
    return String.fromCharCode(parseInt(b, 16))
  })
}

function propVal(name: string, val: string) {
  if (name === 'pnpId') {
    const match = val.match(/\/by-id\/([^\s]+)/)
    return (match?.[1]) || undefined
  }
  if (name === 'manufacturer' || name === 'friendlyName') {
    return decodeHexEscape(val)
  }
  if (/^0x/.test(val)) {
    return val.substr(2)
  }
  return val
}

function getActiveDevices(): Set<string> {
  try {
    /* eslint-disable comma-dangle */
    const validPaths = fs.readdirSync('/dev/serial/by-path').map(file =>
      fs.realpathSync(`/dev/serial/by-path/${file}`)
    )
    /* eslint-enable comma-dangle */
    return new Set(validPaths)
  } catch {
    return new Set()
  }
}

export function linuxList(spawnCmd: typeof spawn = spawn) {
  const ports: PortInfo[] = []
  const udevadm = spawnCmd('udevadm', ['info', '-e'])
  const lines = udevadm.stdout.pipe(new ReadlineParser())
  const validDevices = getActiveDevices()

  let skipPort = false
  let port: PortInfo = {
    path: '',
    manufacturer: undefined,
    serialNumber: undefined,
    pnpId: undefined,
    locationId: undefined,
    vendorId: undefined,
    productId: undefined,
    friendlyName: undefined,
  }

  lines.on('data', (line: string) => {
    const lineType = line.slice(0, 1)
    const data = line.slice(3)
    // new port entry
    if (lineType === 'P') {
      port = {
        path: '',
        manufacturer: undefined,
        serialNumber: undefined,
        pnpId: undefined,
        locationId: undefined,
        vendorId: undefined,
        productId: undefined,
        friendlyName: undefined,
      }
      skipPort = false
      return
    }

    if (skipPort) {
      return
    }

    // Check dev name and save port if it matches flag to skip the rest of the data if not
    if (lineType === 'N') {
      if (checkPathOfDevice(data)) {
        ports.push(port)
      } else {
        skipPort = true
      }
      return
    }

    // parse data about each port
    if (lineType === 'E') {
      const keyValue = data.match(/^(.+)=(.*)/)
      if (!keyValue) {
        return
      }
      const key = propName(keyValue[1]) as keyof PortInfo
      if (!key) {
        return
      }

      port[key] = propVal(key, keyValue[2]) as string
    }
  })

  return new Promise<PortInfo[]>((resolve, reject) => {
    udevadm.on('close', (code: string | null) => {
      if (code) {
        reject(new Error(`Error listing ports udevadm exited with error code: ${code}`))
      }
    })
    udevadm.on('error', reject)
    lines.on('error', reject)
    lines.on('finish', () => {
      const activePorts = ports.filter(port => validDevices.has(port.path))
      resolve(activePorts)
    })
  })
}
