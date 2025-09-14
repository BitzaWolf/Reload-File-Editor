window.reload = {};

// Convert a decimal number into a base-16 representation
const hex = function (dec) {
    let hex = '';
    while (dec > 0) {
        let part = dec % 16;
        if (part === 10)
            part = 'A';
        if (part === 11)
            part = 'B';
        if (part === 12)
            part = 'C';
        if (part === 13)
            part = 'D';
        if (part === 14)
            part = 'E';
        if (part === 15)
            part = 'F';
        hex = part + hex;
        dec = Number.parseInt(dec / 16);
    }
    if (hex.length % 2 === 1)
        hex = `0${hex}`;
    return hex;
};

// Convert a decimal number into its Character equivalent,
const char = function (code) {
    return String.fromCharCode(code);
};
const chars = function (codes) {
    let s = '';
    for (let i = 0; i < codes.length; ++i)
        s += char(codes[i]);
    return s;
};

// These functions convert a series of little endian bytes into a decimal number for JS.
// Assumes reload.bytes has byte data, the offset is valid, and there is enough data available.
const int = function (offset) {
    return reload.bytes[offset + 1] << 8 | reload.bytes[offset];
};
const long = function (offset) {
    return reload.bytes[offset + 3] << 24 | reload.bytes[offset + 2] << 16 | reload.bytes[offset + 1] << 8 | reload.bytes[offset];
};
const long64 = function (offset) {
    return reload.bytes[offset + 7] << 24 | reload.bytes[offset + 6] << 16 | reload.bytes[offset + 5] << 8 | reload.bytes[offset + 4] | reload.bytes[offset + 3] << 24 | reload.bytes[offset + 2] << 16 | reload.bytes[offset + 1] << 8 | reload.bytes[offset];
};
const double = function (offset) {
    return 0.0; // TODO implement
};

// This is a custom type in the RELOAD format. Variable Length Integer. Allows for storage of any size of number.
const vli = function (offset) {
    let val = 0;
    let bytesRead = 1;
    let byte = reload.bytes[offset];
    //console.log(`Reading ${byte}`);
    let isNegative = (byte & 0x40) === 0x40;
    //console.log(`    isNeg: ` + Boolean(isNegative));
    let isMore = (byte & 0x80) === 0x80;
    //console.log(`    isMore: ` + Boolean(isMore));
    val = byte & 0x3F; // get rid of flags
    //console.log(`    flag-less: ${val}`);
    for (let i = 1; isMore; ++i) {
        ++bytesRead;
        byte = reload.bytes[offset + i];
        //console.log(`    Reading more... ${byte}`);
        isMore = (byte & 0x80) === 0x80;
        //console.log(`    isMore: ` + Boolean(isMore));
        byte = byte & 0x7F; // get rid of flag
        //console.log(`    flag-less: ${byte}`);
        if (i === 1) {
            byte = byte << 6;
        } else {
            byte = byte << 7;
            for (let j = i - 1; j > 0; --j)
                byte = byte << 8;
        }
        //console.log(`    byte shifted: ${byte}`);
        val = val | byte;
        //console.log(`    new val: ${val}`);
    }
    if (isNegative)
        val *= -1;
    return {
        val: val,
        bytesRead: bytesRead
    };
};
window.vli = vli; // export the function for testing.

const fatal = function (msg) {
    console.error(`Not a valid Reload file. ${msg}`);
    reload.corrupt = true;
};

let fileInput = document.getElementById('File');
let display = document.getElementById('Display');

const processFile = function() {
    reload.bytes = null;
    reload.corrupt = false;
    reload.file.bytes().then((bytes) => {
        reload.bytes = bytes;
        
        // Header checks
        let magic = chars(bytes.slice(0, 4));
        if (magic !== 'RELD') {
            fatal(`Magic word is not RELD, "${magic}"`);
            return;
        }
        reload.version = bytes.slice(4, 5)[0];
        let headerLength = long(5);
        if (headerLength !== 13) {
            fatal(`Header isn't 13 bytes long. ${headerLength}`);
            return;
        }
        let stringTablePos = long(9);
        if (stringTablePos >= bytes.length) {
            fatal(`String table is past EoF. ${stringTablePos}`);
            return;
        }
        
        // Process String Table
        reload.stringTable = {
            0: ''
        };
        let numOfStrings = vli(stringTablePos);
        let offset = stringTablePos + numOfStrings.bytesRead;
        for (let i = 1; i <= numOfStrings.val; ++i) {
            let stringLength = vli(offset);
            offset += stringLength.bytesRead;
            let string = chars(bytes.slice(offset, offset + stringLength.val));
            offset += stringLength.val;
            reload.stringTable[i] = string;
        }
        
        // The Body
        reload.root = new ReloadElement();
        reload.root.fromBytes(13);
        
        // Show the UI
        display.children[0].remove();
        let list = document.createElement('ul');
        display.appendChild(list);
        reload.root.populateDisplay(list);
    });
    if (reload.corrupt)
        return;
};

fileInput.addEventListener('change', (event) => {
    reload = {};
    reload.file = event.target.files[0];
    processFile();
});
if (fileInput.files[0]) {
    reload = {};
    reload.file = fileInput.files[0];
    processFile();
}

class ReloadElement {
    name = '';
    type = 0;
    data = null;
    children = [];
    offset = 0;
    
    constructor() {
        // If we ever implement DEEP modding and want to add custom elements then we can implement this.
    }
    
    // Loads an element from byte data starting at some offset. Loads all of its children too.
    fromBytes(offset) {
        //console.log(`offset: 0x${hex(offset)}`);
        //if (offset > 350)
        //    return offset + 100;
        
        this.offset = offset;
        let length = long(offset);
        offset += 4;
        let end = offset + length;
        let nameIndex = vli(offset);
        offset += nameIndex.bytesRead;
        this.name = reload.stringTable[nameIndex.val];
        this.type = reload.bytes[offset];
        offset += 1;
        
        if (this.type === 0) {
            // Null node, probably just container
        } else if (this.type === 1) {
            this.data = reload.bytes[offset];
            offset += 1;
        } else if (this.type === 2) {
            this.data = int(offset);
            offset += 2;
        } else if (this.type === 3) {
            this.data = long(offset);
            offset += 4;
        } else if (this.type === 4) {
            this.data = long64(offset);
            offset += 8;
        } else if (this.type === 5) {
            this.data = double(offset);
            offset += 8;
        } else if (this.type === 6) {
            let stringMeta = vli(offset);
            offset += stringMeta.bytesRead;
            this.data = reload.bytes.slice(offset, offset + stringMeta.val);
            this.string = chars(reload.bytes.slice(offset, offset + stringMeta.val));
            let hexCode = '';
            for (let i = 0; i < this.data.length; ++i) {
                hexCode += hex(this.data[i]);
            }
            this.hexCode = hexCode;
            offset += stringMeta.val;
        } else {
            console.error(`Unknown type ID: ${this.type}`);
        }
        
        let childCount = vli(offset);
        offset += childCount.bytesRead;
        
        //console.log(`New element. (${length}) "${this.name}" type:${this.type} #kids: ${childCount.val}`);
        
        for (let i = 0; i < childCount.val; ++i) {
            let kiddo = new ReloadElement();
            offset = kiddo.fromBytes(offset);
            this.children.push(kiddo);
        }
        
        return offset;
    }
    
    populateDisplay(list) {
        let li = document.createElement('li');
        if (this.type === 0) {
            li.innerText = this.name;
        } else if (this.type <= 5) {
            li.innerHTML = `${this.name}: <input type="number" value="${this.data}">`;
        } else if (this.type === 6) {
            let isString = true;
            for (let i = 0; i < this.data.length; ++i) {
                if (isString && (this.data[i] < 32 || this.data[i] > 126)) {
                    isString = false;
                    break;
                }
            }
            if (isString) {
                li.innerHTML = `${this.name}: <input type="text" value="${this.string}">`;
            } else {
                li.innerHTML = `${this.name}: <input type="text" value="${this.hexCode}">`;
            }
        }
        list.appendChild(li);
        
        if (this.children.length > 0) {
            let ul = document.createElement('ul');
            list.appendChild(ul);
            for (let i = 0; i < this.children.length; ++i) {
                this.children[i].populateDisplay(ul);
            }
        }
    }
}
