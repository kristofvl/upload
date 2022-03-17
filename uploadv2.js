
/*
--------------------------------------------------------------------
uploadv2.js Wearable Data Upload Tool
 Copyright 2021 by Kristof Van Laerhoven (ubicomp.eti.uni-siegen.de)
--------------------------------------------------------------------
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
--------------------------------------------------------------------

Version date: 2021-04-18

TODO:
- Set timeout and remove data listener after all downloads
- UI should be cleaner
- progress bar and info should detail more responses from the watch
- plotting of status readings
*/

// html elements
var dataDiv;
var outputDiv;
var prgrsb;
var prgrs;
var plot;
var btnsDiv;

var  smn = 1440;
h    = new Uint8Array(smn);
m    = new Uint8Array(smn);
mag  = new Uint8Array(smn);
dif  = new Uint8Array(smn);
btn1 = new Uint8Array(smn);
btn3 = new Uint8Array(smn);
stps = new Uint8Array(smn);
chrg = new Uint8Array(smn);
tmp  = new Uint8Array(smn);
hrm  = new Uint8Array(smn);
hrc  = new Uint8Array(smn);
mx  = new Uint8Array(smn);
my  = new Uint8Array(smn);
mz  = new Uint8Array(smn);
err = new Uint8Array(smn);

var uplmode = 0;

// string to uint array
function toByteArray(str) {
    //var byteArray = [];
    var byteArray = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++)
        //byteArray.push(str.charCodeAt(i));
        byteArray[i] = str.charCodeAt(i);
    return byteArray;
};

// zero-pad our numbers
function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

// for 64-bit milliseconds timestamps:
function int64_to_str(a, signed) {
  const negative = signed && a[7] >= 128;
  const H = 0x100000000, D = 1000000000;
  let h = a[4] + a[5] * 0x100 + a[6] * 0x10000 + a[7]*0x1000000;
  let l = a[0] + a[1] * 0x100 + a[2] * 0x10000 + a[3]*0x1000000;
  if(negative) {
     h = H - 1 - h;
     l = H - l;
  }
  const hd = Math.floor(h * H / D + l / D);
  const ld = (((h % D) * (H % D)) % D + l) % D;
  const ldStr = ld + '';
  return (negative ? '-' : '') +
         (hd != 0 ? hd + '0'.repeat(9 - ldStr.length) : '') + ldStr;
}


// plotting routines:
var itr = 0;

// on loading the window, init the plot canvas and assign vars to all elements we want to control:
window.onload = function() {
	plot = document.getElementById('plot');
  plot.style.visibility = 'hidden';
  prgrsb= document.getElementById("myProgress");
  prgrs = document.getElementById("myBar");
  outputDiv = document.querySelector("#output");
	dataDiv = document.querySelector("#data");
  btnsDiv = document.getElementById("buttons");
};

// global variables for parsing incoming data:
var readBuffer = new Uint8Array(1000000); //temp buffer that surely big enough
var fitr = 0;
var filename = "default.bin";
var numFiles = 0;
var GS = 0;
var HZ = 0;
var tmestamp = "";
var deltaCounter = 0;
var deltaMSB = new Int16Array(3);
var newxyz = new Int16Array(3);
var dmode = 0;
var rnd_itr = 0;
var fopen = false;
var status_len = 0;
var ffCount=0;
var zzCount=0;
var parsedThisFileNum = 0;
var parsedFilesNum = 0;

// parse the binary array arr of bytes from startByte to stopByte,
// while in state dmode. Returns last state
function parseBin(arr, startByte, stopByte) {
	var ret = 0;
	for (var i=startByte; i<stopByte; i++) {
		switch (dmode) {
			case 0:  // new package, delta encoding not on
							if (arr[i]==0xFF) { dmode = 1; }
							else { newxyz[0]=arr[i]; dmode = 9; }
							break;
			case 1:  // new package, no delta, one preceding 0xFF
							if (arr[i]==0xFF) { dmode = 2; }
							else { newxyz[0]=0xFF|(arr[i]<<8); dmode = 10;}
							break;
			case 2:  // new package, delta on, two preceding 0xFFs
							if (arr[i]==0xFF) {
								deltaCounter=0; dmode = 20; ffCount = 3;
							} else {
								deltaCounter=arr[i];
								dmode = 5;
							}
							break;
			case 5:  // delta encoding ongoing, x:
							newxyz[0]=arr[i]|(deltaMSB[0]<<8); dmode = 6;
							break;
			case 6:  // delta encoding ongoing, y:
							newxyz[1]=arr[i]|(deltaMSB[1]<<8); dmode = 7;
							break;
			case 7:  // delta encoding ongoing, z:
							newxyz[2]=arr[i]|(deltaMSB[2]<<8);
							dx[rnd_itr]=newxyz[0];
							dy[rnd_itr]=newxyz[1];
							dz[rnd_itr]=newxyz[2];
							if (rnd_itr==len-1) rnd_itr=0; else rnd_itr=rnd_itr+1;
              if (deltaCounter==0) { dmode = 0; } else { deltaCounter--; dmode = 14; }
							break;
			case 9:  // no delta encoding, x2:
							deltaMSB[0]=arr[i];newxyz[0]=newxyz[0]|(deltaMSB[0]<<8);
							dmode = 10;
							break;
			case 10:  // no delta encoding, y1:
							newxyz[1]=arr[i]; dmode = 11;
							break;
			case 11:  // no delta encoding, y2:
							deltaMSB[1]=arr[i];newxyz[1]=newxyz[1]|(deltaMSB[1]<<8);
							dmode = 12;
							break;
			case 12:  // no delta encoding, z1:
							newxyz[2]=arr[i]; dmode = 13;
							break;
			case 13:  // no delta encoding, z2:
							deltaMSB[2]=arr[i];newxyz[2]=newxyz[2]|(deltaMSB[2]<<8);
							dmode = 0;
							dx[rnd_itr]=newxyz[0];
							dy[rnd_itr]=newxyz[1];
							dz[rnd_itr]=newxyz[2];
							if (rnd_itr==len-1) rnd_itr=0; else rnd_itr=rnd_itr+1;
							break;
			case 14:// delta encoding underway, x:
							newxyz[0]=arr[i]|(deltaMSB[0]<<8); dmode = 17;
							break;
			case 17: // delta encoding underway, y:
							newxyz[1]=arr[i]|(deltaMSB[1]<<8); dmode = 18;
							break;
			case 18: // delta encoding underway, z:
							newxyz[2]=arr[i]|(deltaMSB[2]<<8);
							dx[rnd_itr]=newxyz[0];
							dy[rnd_itr]=newxyz[1];
							dz[rnd_itr]=newxyz[2];
							if (rnd_itr==len-1) rnd_itr=0; else rnd_itr=rnd_itr+1;
              if (deltaCounter==0) {
                dmode = 0;
							} else {
                deltaCounter--;
                dmode = 14;
							}
							break;
        case 20: // state 1 for eof sequence detection, count FFs:
              if (arr[i] == 0xFF) {
                ffCount++;
                if (ffCount==5)
                  ccCount = 0;
                  dmode = 21;
              } else {
                if (ffCount==4) {
                  newxyz[0]=0xFF|(arr[i]<<8); dmode = 10;
                } else {
                  newxyz[0]=arr[i]; dmode = 9;
                }
                ffCount = 0;
              }
              break;
        case 21: // state 2 for eof sequence detection, count  0s:
              if (arr[i] == 0) {
                ffCount = 0;
                zzCount++;
                if (zzCount==6) {
                  zzCount = 0;
                  dmode = 22;
                }
              } else if (arr[i] == 0xFF) {
                ffCount++;
              } else {
                ffCount = 0;
                newxyz[0]=arr[i];
                dmode = 9;
              }
              break;
        case 22: // state 3 for eof sequence detection, count FFs:
              if (arr[i] == 0xFF) {
                ffCount++;
                if (ffCount>1) {
                  dmode = 23; // read this file's number next
                }
              }
              break;
        case 23: // read this file's number:
              parsedThisFileNum = arr[i];
              dmode = 24; // read all files' number next
              break;
        case 24: // read total files' number:
              parsedFilesNum = arr[i];
              ret = 255; // eof!
              dmode = 0; // go back to default
              break;
				default:
							ret = 2;  // inconsistent data
		}
	} // for .. over  arr[startByte..stopByte]
	return ret;
}

var Int8 = function (ref) {
	return (ref > 0x7F) ? ref - 0x100 : ref;
};

function parseStatus(arr) {
  var ret = 0;
  for (var i=0; i<arr.length; i++) {
		switch (dmode) {
      case 0: if (arr[i]!=255) h[rnd_itr] = arr[i];
              else { ffCount = 1; dmode = 99;} // last sensible byte has passed, just FFs from here
              break;
      case 1: if (arr[i]!=255) m[rnd_itr] = arr[i];
              else { ffCount = 1; dmode = 99;}
              break;
      case 2: mag[rnd_itr] = arr[i]; break;
      case 3: dif[rnd_itr] = arr[i]; break;
      case 4: btn1[rnd_itr]= arr[i]%8; btn3[rnd_itr] = arr[i]/8; break;
      case 5: stps[rnd_itr]= arr[i]; break;
      case 6: mx[rnd_itr]  = arr[i]; break;
      case 7: my[rnd_itr]  = arr[i]; break;
      case 8: mz[rnd_itr]  = arr[i]; break;
      case 9: chrg[rnd_itr]= arr[i]; break;
      case 10: tmp[rnd_itr]= arr[i]; break;
      case 11: hrm[rnd_itr]= arr[i]; break;
      case 12: hrc[rnd_itr]= arr[i]; break;
      case 13: err[rnd_itr] = arr[i]; rnd_itr++; status_len++; ret = 3; break; // last byte of packet
      case 99: if (arr[i] == 0xFF) {
                  ffCount++;
                  if (ffCount==5)
                    dmode = 100;
                }
                break;
      case 100: if (arr[i] == 0) {
                  ffCount = 0;
                  zzCount++;
                  if (zzCount==5) {
                    zzCount = 0;
                    dmode = 101;
                  }
                } else if (arr[i] == 0xFF)
                {
                  ffCount++;
                }
                break;
      case 101: // state 3 for eof sequence detection, count FFs:
                if (arr[i] == 0xFF) {
                  ffCount++;
                  if (ffCount>1) {
                    dmode = 102; // read this file's number next
                  }
                }
                break;
      case 102: // read this file's number:
                parsedThisFileNum = arr[i];
                dmode = 103; // read all files' number next
                break;
      case 103: // read total files' number:
                parsedFilesNum = arr[i];
                ffCount = 0; zzCount = 0;
                dmode = 0; // go back to default
                ret = 255; // eof!
                break;
    } // switch
    if (dmode<14) dmode = (dmode+1)%14;
  } // for
  return ret;
}

// Functions by Gordon Williams:
/** Get a Lexer to parse JavaScript - this is really very nasty right now and it doesn't lex even remotely properly.
   * It'll return {type:"type", str:"chars that were parsed", value:"string", startIdx: Index in string of the start, endIdx: Index in string of the end}, until EOF when it returns undefined */
  function getLexer(str) {
    // Nasty lexer - no comments/etc
    var chAlpha="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
    var chNum="0123456789";
    var chAlphaNum = chAlpha+chNum;
    var chWhiteSpace=" \t\n\r";
    var chQuotes = "\"'`";
    var ch;
    var idx = 0;
    var lineNumber = 1;
    var nextCh = function() {
      ch = str[idx++];
      if (ch=="\n") lineNumber++;
    };
    nextCh();
    var isIn = function(s,c) { return s.indexOf(c)>=0; } ;
    var nextToken = function() {
      while (isIn(chWhiteSpace,ch)) {
        nextCh();
      }
      if (ch==undefined) return undefined;
      if (ch=="/") {
        nextCh();
        if (ch=="/") {
          // single line comment
          while (ch!==undefined && ch!="\n") nextCh();
          return nextToken();
        } else if (ch=="*") {
          nextCh();
          var last = ch;
          nextCh();
          // multiline comment
          while (ch!==undefined && !(last=="*" && ch=="/")) {
            last = ch;
            nextCh();
          }
          nextCh();
          return nextToken();
        }
        return {type:"CHAR", str:"/", value:"/", startIdx:idx-2, endIdx:idx-1, lineNumber:lineNumber};
      }
      var s = "";
      var type, value;
      var startIdx = idx-1;
      if (isIn(chAlpha,ch)) { // ID
        type = "ID";
        do {
          s+=ch;
          nextCh();
        } while (isIn(chAlphaNum,ch));
      } else if (isIn(chNum,ch)) { // NUMBER
        type = "NUMBER";
        var chRange = chNum;
        if (ch=="0") { // Handle
          s+=ch;
          nextCh();
          if ("xXoObB".indexOf(ch)>=0) {
            if (ch=="b" || ch=="B") chRange="01";
            if (ch=="o" || ch=="O") chRange="01234567";
            if (ch=="x" || ch=="X") chRange="0123456789ABCDEFabcdef";
            s+=ch;
            nextCh();
          }
        }
        while (isIn(chRange,ch) || ch==".") {
          s+=ch;
          nextCh();
        }
      } else if (isIn(chQuotes,ch)) { // STRING
        type = "STRING";
        var q = ch;
        value = "";
        s+=ch;
        nextCh();
        while (ch!==undefined && ch!=q) {
          s+=ch;
          if (ch=="\\") {
            nextCh();
            s+=ch;
            // FIXME: handle hex/etc correctly here
          }
          value += ch;
          nextCh();
        };
        if (ch!==undefined) s+=ch;
        nextCh();
      } else {
        type = "CHAR";
        s+=ch;
        nextCh();
      }
      if (value===undefined) value=s;
      return {type:type, str:s, value:value, startIdx:startIdx, endIdx:idx-1, lineNumber:lineNumber};
    };

    return {
      next : nextToken
    };
  };
/// Parse and fix issues like `if (false)\n foo` in the root scope
function reformatCode(code) {
   var APPLY_LINE_NUMBERS = false;
   var lineNumberOffset = 0;
   // Turn cr/lf into just lf (eg. windows -> unix)
  code = code.replace(/\r\n/g,"\n");
  // First off, try and fix funky characters
  for (var i=0;i<code.length;i++) {
    var ch = code.charCodeAt(i);
    if ((ch<32 || ch>255) && ch!=9/*Tab*/ && ch!=10/*LF*/ && ch!=13/*CR*/) {
      console.warn("Funky character code "+ch+" at position "+i+". Replacing with ?");
      code = code.substr(0,i)+"?"+code.substr(i+1);
    }
  }

  /* Search for lines added to the start of the code by the module handler.
  Ideally there would be a better way of doing this so line numbers stayed correct,
  but this hack works for now. Fixes EspruinoWebIDE#140 */
  if (APPLY_LINE_NUMBERS) {
    var l = code.split("\n");
    var i = 0;
    while (l[i] && (l[i].substr(0,8)=="Modules." ||
                    l[i].substr(0,8)=="setTime(")) i++;
    lineNumberOffset = -i;
  }

  var resultCode = "\x10"; // 0x10 = echo off for line
  /** we're looking for:
   *   `a = \n b`
   *   `for (.....) \n X`
   *   `if (.....) \n X`
   *   `if (.....) { } \n else foo`
   *   `while (.....) \n X`
   *   `do \n X`
   *   `function (.....) \n X`
   *   `function N(.....) \n X`
   *   `var a \n , b`    `var a = 0 \n, b`
   *   `var a, \n b`     `var a = 0, \n b`
   *   `a \n . b`
   *   `foo() \n . b`
   *   `try { } \n catch \n () \n {}`
   *
   *   These are divided into two groups - where there are brackets
   *   after the keyword (statementBeforeBrackets) and where there aren't
   *   (statement)
   *
   *   We fix them by replacing \n with what you get when you press
   *   Alt+Enter (Ctrl + LF). This tells Espruino that it's a newline
   *   but NOT to execute.
   */
  var lex = getLexer(code);
  var brackets = 0;
  var curlyBrackets = 0;
  var statementBeforeBrackets = false;
  var statement = false;
  var varDeclaration = false;
  var lastIdx = 0;
  var lastTok = {str:""};
  var tok = lex.next();
  while (tok!==undefined) {
    var previousString = code.substring(lastIdx, tok.startIdx);
    var tokenString = code.substring(tok.startIdx, tok.endIdx);
    //console.log("prev "+JSON.stringify(previousString)+"   next "+tokenString);

    /* Inserting Alt-Enter newline, which adds newline without trying
    to execute */
    if (brackets>0 || // we have brackets - sending the alt-enter special newline means Espruino doesn't have to do a search itself - faster.
        statement || // statement was before brackets - expecting something else
        statementBeforeBrackets ||  // we have an 'if'/etc
        varDeclaration || // variable declaration then newline
        tok.str=="," || // comma on newline - there was probably something before
        tok.str=="." || // dot on newline - there was probably something before
        tok.str=="+" || tok.str=="-" || // +/- on newline - there was probably something before
        tok.str=="=" || // equals on newline - there was probably something before
        tok.str=="else" || // else on newline
        lastTok.str=="else" || // else befgore newline
        tok.str=="catch" || // catch on newline - part of try..catch
        lastTok.str=="catch"
      ) {
      //console.log("Possible"+JSON.stringify(previousString));
      previousString = previousString.replace(/\n/g, "\x1B\x0A");
    }

    var previousBrackets = brackets;
    if (tok.str=="(" || tok.str=="{" || tok.str=="[") brackets++;
    if (tok.str=="{") curlyBrackets++;
    if (tok.str==")" || tok.str=="}" || tok.str=="]") brackets--;
    if (tok.str=="}") curlyBrackets--;

    if (brackets==0) {
      if (tok.str=="for" || tok.str=="if" || tok.str=="while" || tok.str=="function" || tok.str=="throw") {
        statementBeforeBrackets = true;
        varDeclaration = false;
      } else if (tok.str=="var") {
        varDeclaration = true;
      } else if (tok.type=="ID" && lastTok.str=="function") {
        statementBeforeBrackets = true;
      } else if (tok.str=="try" || tok.str=="catch") {
        statementBeforeBrackets = true;
      } else if (tok.str==")" && statementBeforeBrackets) {
        statementBeforeBrackets = false;
        statement = true;
      } else if (["=","^","&&","||","+","+=","-","-=","*","*=","/","/=","%","%=","&","&=","|","|="].indexOf(tok.str)>=0) {
        statement = true;
      } else {
        if (tok.str==";") varDeclaration = false;
        statement = false;
        statementBeforeBrackets = false;
      }
    }
    /* If we're at root scope and had whitespace/comments between code,
    remove it all and replace it with a single newline and a
    0x10 (echo off for line) character. However DON'T do this if we had
    an alt-enter in the line, as it was there to stop us executing
    prematurely */
    if (previousBrackets==0 &&
        previousString.indexOf("\n")>=0 &&
        previousString.indexOf("\x1B\x0A")<0) {
      previousString = "\n\x10";
      // Apply line numbers to each new line sent, to aid debugger
      if (APPLY_LINE_NUMBERS && tok.lineNumber && (tok.lineNumber+lineNumberOffset)>0) {
        // Esc [ 1234 d
        // This is the 'set line number' command that we're abusing :)
        previousString += "\x1B\x5B"+(tok.lineNumber+lineNumberOffset)+"d";
      }
    }

    // add our stuff back together
    resultCode += previousString+tokenString;
    // next
    lastIdx = tok.endIdx;
    lastTok = tok;
    tok = lex.next();
  }
  //console.log(resultCode);
  if (brackets>0) {
    return undefined;
  }
  if (brackets<0) {
    return undefined;
  }
  return resultCode;
};


var CHUNKSIZE = 384;// or any multiple of 96 for atob/btoa
function atob(input) {
  // Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149
  // This code was written by Tyler Akins and has been placed in the
  // public domain.  It would be nice if you left this header intact.
  // Base64 code from Tyler Akins -- http://rumkin.com
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  do {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));
    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;
    output = output + String.fromCharCode(chr1);
    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  } while (i < input.length);
  return output;
}
// Get Code to upload a file to the Bangle.js FLASH
function getUploadFileCode(fileName, contents) {
	var js = [];
	if ("string" != typeof contents)
		throw new Error("Expecting a string for contents");
	if (fileName.length==0 || fileName.length>28)
		throw new Error("Invalid filename length");
	var fn = JSON.stringify(fileName);
	for (var i=0;i<contents.length;i+=CHUNKSIZE) {
		var part = contents.substr(i,CHUNKSIZE);
		js.push(`require("Storage").write(${fn},atob(${JSON.stringify(btoa(part))}),${i}${(i==0)?","+contents.length:""})`);
	}
	return js.join("\n");
}

// update dialog to show we're connecting
function connect_show() {
  btnsDiv.style.display="none";
	prgrsb.style.backgroundColor = 'white';
	prgrs.style.backgroundColor = 'green';
	dataDiv.textContent = "Connecting...";
	prgrs.style.width = 10+"%";
	Puck.flowControl = true; // allow flow control till we get binary data back
}

// update dialog to show we're done with connection
function connect_done(msg) {
  dataDiv.textContent = msg;
  btnsDiv.style.display="block";
  prgrsb.style.backgroundColor = '#ccc';
  prgrs.style.backgroundColor = '#ccc';
}

// install the latest activate app
function connect_install() {
  connect_show();
	Puck.connect(function(connection) {
    if (!connection) { connect_done("Connection closed."); return; }
    // when the connection is closed (by the bangle)
    connection.on('close', function() {
      console.log("Connection closed");
      dataDiv.textContent = "Done.";
      btnsDiv.style.display="block";
      prgrsb.style.backgroundColor = '#ccc';
      prgrs.style.backgroundColor = '#ccc';
    });
		outputDiv.textContent = "Name:"+connection.device.name+"  ID:"+connection.device.id;
		outputDiv.style.visibilty = 'visible';

		// check first for bootloader version:
		dataDiv.textContent = "Connected. Checking version...";
		prgrs.style.width = 1+"%";
    var ver_ret = "";
		connection.on('data',function(dt) { ver_ret+=dt; }); // callback for writes
		console.log(connection);
    connection.write('reset();process.env.VERSION\n',
				function() { setTimeout(function(){inst_step2(ver_ret,connection); },700); });
	}); // connect()
}
function inst_step2(ver_ret, connection) {
	console.log("version:"+ ver_ret);
	if (ver_ret.match(/2v09/g)) {
			dataDiv.textContent = "Version 2.09 found, syncing time...";
			prgrs.style.width = "5%";
			var tme_ret = "";
			connection.on('data',function(dt) { tme_ret+=dt; }); // callback for writes
			var d = new Date();
	    var cmd = '\x10setTime('+(d.getTime()/1000)+');';
			cmd += 'if (E.setTimeZone) E.setTimeZone('+d.getTimezoneOffset()/-60+');\n';
			connection.write(cmd, function() {setTimeout(function(){inst_step3(tme_ret,connection); },700);});
	} else {
		dataDiv.textContent = "Version 2.09 not found! Did you update this watch's firmware? (Reload this page to try again)";
		prgrs.style.width = "100%";
	}
}
function inst_step3(tme_ret, connection) {
	console.log("time:"+ tme_ret);
	if (tme_ret=="") {
		dataDiv.textContent = "Time synced. Erasing apps and settings...";
		prgrs.style.width = "10%";
		var searchAllCmd = "var fL=require('Storage').list();";
		var eraseAllCmd = "for (var i=0;i<fL.length;i++) require('Storage').erase(fL[i]);\n";
		var bar_itr = 20;
		var block=false;
		if (!block) {
					var ers_ret = "";
					connection.on('data',function(dt) { ers_ret+=dt; }); // callback for writes
					connection.write(searchAllCmd+eraseAllCmd, function() {
							setTimeout( function(){
										console.log(ers_ret);
										block=false;
										inst_step4(ers_ret, connection);
							}, 700);
					});
					block=true;
		}
	}
}
function inst_step4(ers_ret, connection) {
	console.log("ers:"+ ers_ret);
	if (ers_ret.search(/=undefined/i)) {
		dataDiv.textContent = "Erasing Done. ";
		prgrs.style.width = "20%";
		if (1) {
			uplmode = 0;
			var ii = 30;
			var ret_str = "";
			connection.on('data',function(dt) { ret_str+=dt; }); // callback for writes
			var uplint = setInterval( function() {
				prgrs.style.width = ii+"%"; ii+=.15;
				switch(uplmode) {
						case 0: dataDiv.textContent = "Compacting flash memory...";
										uplmode=-1; connection.write("require('Storage').compact()\n",function() { setTimeout(function(){ console.log("Compact: "+ret_str); ret_str=""; uplmode=1;},7500);});
										break;
						case 1: dataDiv.textContent = "Installing .bootcde";
										uplmode=-1; var ffn = 'bootcde.txt'; fetch(ffn)
							        .then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode('.bootcde', text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=2; },500); });
							         });
										break;
						case 2: dataDiv.textContent = "Installing bootupdate.js";
										uplmode=-1; var ffn = 'bootupdate.js'; fetch(ffn)
							        .then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode(ffn, text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=3; },500); });
							         });
										break;
						case 3: dataDiv.textContent = "Installing .boot0";
										uplmode=-1; var ffn = 'boot0.txt'; fetch(ffn)
							        .then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode('.boot0', text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=4; },500); });
							         });
										break;

						case 4: dataDiv.textContent = "Installing launch.app.js";
										uplmode=-1; var ffn = 'launch.app.js'; fetch(ffn)
											.then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode(ffn, text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=5; },500); });
											 });
										break;
						case 5: dataDiv.textContent = "Installing launch.info";
										uplmode=-1; connection.write("\x10require('Storage').write('setting.info',{'id':'launch','name':'Launcher','type':'launch','src':'launch.app.js','sortorder':-10,'version':'0.06','files':'launch.info,launch.app.js'})\n",
												function() {console.log("info file saved"); uplmode=6;});
										break;

						case 6: dataDiv.textContent = "Installing setting.app.js";
										uplmode=-1; var ffn = 'setting.app.js'; fetch(ffn)
											.then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode(ffn, text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=7; },500); });
											 });
										break;
						case 7: dataDiv.textContent = "Installing setting.json";
										uplmode=-1; var ffn = 'setting.json'; fetch(ffn)
											.then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode(ffn, text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=8; },500); });
											 });
										break;
						case 8: dataDiv.textContent = "Installing setting.info";
										uplmode=-1; connection.write("\x10require('Storage').write('setting.info',{'id':'setting','name':'Settings','src':'setting.app.js','icon':'setting.img','sortorder':-2,'version':'0.26','files':'setting.info,setting.app.js,setting.img,setting.json','data':'setting.json'})\n",
												function() {console.log("info file saved"); uplmode=9;});
										break;
						case 9: dataDiv.textContent = "Installing setting.img";
										uplmode=-1; var ffn = 'setting.img'; fetch(ffn)
											.then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode(ffn, text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=10; },500); });
											 });
										break;

						case 10: dataDiv.textContent = "Installing activate.app.js";
										uplmode=-1; var ffn = 'activate.app.js'; fetch(ffn)
							        .then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode(ffn, text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=11;},500); });
							         });
										break;
						case 11: dataDiv.textContent = "Installing activate.info";
										uplmode=-1; connection.write("\x10require('Storage').write('activate.info',{'name':'Activate','type':'clock','sortorder':-9,'src':'activate.app.js','icon':'activate.img'})\n",
												function() {console.log("info file saved"); uplmode=12;});
										break;
						case 12: dataDiv.textContent = "Installing activate.img";
										uplmode=-1; var ffn = 'activate.img'; fetch(ffn)
							        .then(response => response.text()).then(text => {
												var js = "\x10"+getUploadFileCode(ffn, text).replace(/\n/g,"\n\x10");
												connection.write(js+"\n", function() { setTimeout(function(){ console.log(ffn+" sent."); uplmode=13;},500); });
							         });
										break;

						case 13: dataDiv.textContent = "Setting time.";
										uplmode=-1;
										var d = new Date();
								    var cmd = '\x10setTime('+(d.getTime()/1000)+');if (E.setTimeZone) E.setTimeZone('+d.getTimezoneOffset()/-60+')\n';
										connection.write(cmd, function() { setTimeout(function(){ console.log("Time set."); uplmode=14;},500);});
										break;
						case 14: dataDiv.textContent = "Resetting ...";
										uplmode=-1; connection.write("E.reboot()\n",function() { setTimeout(function(){ console.log("rebooted."+ret_str); uplmode=15;},500);});
										break;
						case 15: clearInterval(uplint);
										connection.close();
										break;
				}
    	}, 300);
		}
	}
}






// start getting status updates
function connect_status() {
  connect_show();
	Puck.connect(function(connection) {
    if (!connection) { connect_done("Connection cancelled."); return; }
    outputDiv.textContent = "Name:"+connection.device.name+"  ID:"+connection.device.id;
		outputDiv.style.visibilty = 'visible';
		dataDiv.textContent = "Connected. Asking Status...";
		prgrs.style.width = 70+"%";
    dataDiv.textContent = "Status report:\n";
    var readingstr = "";
		if (1) {  // quick status
			Puck.flowControl = false;
			connection.on('data',function(dt) {
						var Data = new Uint8Array(toByteArray(dt));
						var steps = Data[0]+Data[1]*0x100+Data[2]*0x10000+Data[3]*0x1000000;
						var actmins =  Data[4]+Data[5]*0x100;
						var lowAct =  Data[6]+Data[7]*0x100;
						var medAct =  Data[8]+Data[9]*0x100;
						var higAct =  Data[10]+Data[11]*0x100;
						dataDiv.textContent = "steps: "+steps+", actMins: "+actmins+", lowAct: "+lowAct+", medAct: "+medAct+", higAct: "+higAct;
					}); // callback for write
			setInterval( function() { connection.write("\x10rv()\n", function() {}); }, 1000 );

		} else {  // status as string
	    connection.on('data',function(dt) { readingstr += dt.replace(/[^\d,-]/g, ''); }); // callback for write
	    setInterval( function() {
	  		connection.write("[].slice.call(myStatus)\n", function() {
	        setTimeout( function() {
	          var nums = readingstr.split(",");
	          dataDiv.textContent = "HH   MM   MAG  DIF  BTN  STP  MX   MY   MZ   CH   TMP  HRM  HRC  END\n";
	          for (var ii=0;ii<nums.length;ii++) {
	            dataDiv.textContent += ("00"+nums[ii]).substr(-3)+"  ";
	          }
	    		}, 300);
	      });
	      readingstr = "";
	    }, 3000);
		}
    btnsDiv.style.display="block";
    prgrsb.style.backgroundColor = '#ccc';
	  prgrs.style.backgroundColor = '#ccc';
    // when the connection is closed (by the bangle)
    connection.on('close', function() { connect_done("Connection closed."); Puck.flowControl = true; });
	}); // connect
}







// upload logged data
function connect_upload() {
  connect_show();
	Puck.connect(function(connection) {
    if (!connection) {
      dataDiv.textContent = dataDiv.textContent.split("\r\n").slice(1).join("\r\n");
      connect_done("Connection cancelled.\n"+dataDiv.textContent); return;
    }
		outputDiv.textContent = "Name:"+connection.device.name+"  ID:"+connection.device.id;
		outputDiv.style.visibilty = 'visible';
		dataDiv.textContent = "Connected. Collecting data...";
		prgrsb.style.backgroundColor = 'grey';
    prgrs.style.backgroundColor = 'green';
    prgrs.style.width = 0+"%";
    plot.style.visibility = 'visible';
    dataDiv.style.visibility = 'visible';
    outputDiv.style.visibilty = 'visible';
    var numFilesStr = "";
    var cmdPrefix = ""; //"Bangle.";
    connection.on('data',function(dt){
        numFilesStr += dt.replace(/\D/g,'');
        console.log('dt:'+dt);
    }); // read number of files
		var d = new Date();
		var cmd = '\x10setTime('+(d.getTime()/1000)+');';
		cmd += 'if (E.setTimeZone) E.setTimeZone('+d.getTimezoneOffset()/-60+');\n';
		connection.write(cmd, function() {console.log("set time.");});
		connection.write(cmdPrefix+'startUpload()\n', function(ret) {console.log('su:'+ret);} );
    setTimeout( function() {
       console.log('numFiles:'+Number(numFilesStr));
       numFiles = Number(numFilesStr);
       if (numFiles>0) {
           // Handle data coming back:
       		Puck.flowControl = false;  // don't mess with the binary data
       		deltaCounter = 0; dmode = 0; rnd_itr = 0; // reset parsing variables
          filename = 'default.bin'; tmestamp = "";
       		connection.on('data',function(d) {
       			switch (handleReply(d) ) {
       				case 1:		// file name packet just came in:
       									if (fitr==0) {
       										dataDiv.textContent += "\r\nID  Filename          GS HZ   ID/Sum  Size   Start time"
       											+"\r\n=================================================================";
       									}
       									dataDiv.textContent += "\r\n"+pad(fitr,3)+" "+filename;
       									break;
       				case 2: 	// end-of-file packet received:
                        console.log("end of file #"+pad(parsedThisFileNum,3)+" of "+pad(parsedFilesNum,3)+", size:"+pad(itr,6));
                        var storedta = new Uint8Array(itr);
                        for (var iii=0;iii<itr;iii++) storedta[iii] = readBuffer[iii];
                        downloadBlob(storedta, filename, 'application/octet-stream');
                        dataDiv.textContent += " "+pad(parsedThisFileNum,3)+"/"
                                              +pad(parsedFilesNum,3)+" "+pad(itr,6)+" "+tmestamp;
                        fopen = false; fitr = fitr + 1;
                        if (filename==="d20statusmsgs.bin") { // plot overview of the entire recording
                          rnd_itr = 0;
                          var scaler = 255;
                          var len = status_len*3; // cater for min-max plotting
                          if (len<180) len += (360-len); // add a bit to avoid plotting too little data
                          var ylbls = [6, 4, 2, 0, -2, -4, -6];
                          var dx = new Int16Array(len);
                          var dy = new Int16Array(len);
                          var dz = new Int16Array(len);
                          var ds = new Int16Array(len);
                          var da = new Int16Array(len);
                          var lbls = []; // times array  // Array.from({length: len}, (_, i) => i + 1);
                          var ii=0;
                          while (rnd_itr<status_len) {
                            if (h[rnd_itr]==255) { rnd_itr=status_len; }
                            else {
                              lbls[ii] = h[rnd_itr]+":"+pad(m[rnd_itr],2);
                              dx[ii] = mx[rnd_itr]*scaler;
                              dy[ii] = my[rnd_itr]*scaler;
                              dz[ii] = mz[rnd_itr]*scaler;
                              ds[ii] = stps[rnd_itr];
                              da[ii] = (dif[rnd_itr]>14)?23900:25000;
                              ii++;
                              lbls[ii] = h[rnd_itr]+":"+pad(m[rnd_itr],2);
                              dx[ii] = (mx[rnd_itr]+dif[rnd_itr])*scaler;
                              dy[ii] = (my[rnd_itr]-dif[rnd_itr])*scaler;
                              dz[ii] = (mz[rnd_itr]+dif[rnd_itr])*scaler;
                              ds[ii] = stps[rnd_itr];
                              da[ii] = (dif[rnd_itr]>14)?23900:25000;
                              ii++;
                              lbls[ii] = h[rnd_itr]+":"+pad(m[rnd_itr],2);
                              dx[ii] = (mx[rnd_itr]-dif[rnd_itr])*scaler;
                              dy[ii] = (my[rnd_itr]+dif[rnd_itr])*scaler;
                              dz[ii] = (mz[rnd_itr]-dif[rnd_itr])*scaler;
                              ds[ii] = stps[rnd_itr];
                              da[ii] = (dif[rnd_itr]>14)?23900:25000;
                              ii++;
                              rnd_itr++;
                              //csv += mag[rnd_itr]+','+dif[rnd_itr];
                              //csv += ','+btn1[rnd_itr]+','+btn3[rnd_itr]+','++',';
                              //csv += chrg[rnd_itr];
                              //csv += ','+tmp[rnd_itr]+','+hrm[rnd_itr]+','+hrc[rnd_itr];
                              //csv += "\n";
                            }
                          }
                          // pad lbls:
                          while (ii<len) {
                            lbls[ii] = "";
                            ii++;
                          }
                          var config_acc = { type: 'bar',
                          	data: {
                          		labels: lbls,
                          		datasets: [{ label:'x, ', type:'line', yAxisID:'A', data:dx, borderColor:'rgba(255, 0, 0, 200)',pointRadius:.1,borderWidth:1,backgroundColor:'rgba(0, 0, 0, 0)',fill:false,lineTension:0.2},
                                         { label:'y, ', type:'line', yAxisID:'A', data:dy, borderColor:'rgba(0, 255, 0, 200)',pointRadius:.1,borderWidth:1,backgroundColor:'rgba(0, 0, 0, 0)',fill:false,lineTension:0.2},
                                         { label:'z, ', type:'line', yAxisID:'A', data:dz, borderColor:'rgba(0, 0, 255, 200)',pointRadius:.1,borderWidth:1,backgroundColor:'rgba(0, 0, 0, 0)',fill:false,lineTension:0.2},
                                         { label:'steps, ', data:ds, yAxisID:'B', borderWidth:0, backgroundColor:'rgba(0, 200, 200, 200)',fill:true, barPercentage:1},
                                         { label:'act', type:'line', yAxisID:'A', data:da, pointRadius:2,borderWidth:0,pointgroundColor:'black',fill:true,showLine:false}
                                        ]
                          	},
                          	options: { tooltips:{enabled: false}, events:[],
                          		legend: {position:'top', align:'end', rtl:false, labels:{boxWidth:3,padding:1}},
                          		normalized: true, animation: false, responsive:true,   title: { display: false, text: '' },
                          		scales: { xAxes:[{display:true,scaleLabel:{display:false}, ticks:{fontSize:7}}],
                          							yAxes:[{id:'A',type:'linear', position:'left',display:true, scaleLabel:{display:false},
                                                ticks: { min:-24000, max:24000, stepSize:8000, fontSize:10,
                          															callback: function(value, index, values) { return ylbls[index]; }
                          											},
                                              }, {id:'B',type:'linear', position:'right', ticks:{fontSize:7}} ]
                          		}
                          	}
                          };
                          var ctx_acc = document.getElementById('plotcanvas').getContext('2d');
                          window.myLine = new Chart(ctx_acc, config_acc);
                        }
                        if (parsedThisFileNum==parsedFilesNum) { // last file uploaded?
                          btnsDiv.style.display="block";
                          prgrsb.style.backgroundColor = '#ccc';
         									prgrs.style.backgroundColor = '#ccc';
         									//plot.style.visibility = 'hidden';
         									dataDiv.textContent = dataDiv.textContent.split("\r\n").slice(1).join("\r\n");
                          dataDiv.textcontent+="\r\n=================================================================";
                          connection.write(
														'\x10stpUp('+document.getElementById("HZ").value+','
															+document.getElementById("GS").value+','
															+((document.getElementById("ST").value=="")?25:document.getElementById("ST").value)+')\n');
                        } else {
                          timedUpload(connection, fitr);
                        }
       									break;
       				case 3: 	// normal data just pased by:
                        if (itr%400==0) {
       										prgrs.style.width = Number((itr%70000)/700)+"%";
       									}
                        //else if (itr%1000==0) {
       									//	window.myLine.update();
       									//}
                        if (itr>201632) {  // we missed the end-of-file sequence
                            console.log('Check: past end-of-file. len=',d.length);
                            parsedThisFileNum++;
                            console.log("end of file #"+pad(parsedThisFileNum,3)+" of "+pad(parsedFilesNum,3)+", size:"+pad(itr,6));
                            var storedta = new Uint8Array(itr);
                            for (var iii=0;iii<itr;iii++) storedta[iii] = readBuffer[iii];
                            downloadBlob(storedta, filename, 'application/octet-stream');
                            dataDiv.textContent += " "+pad(parsedThisFileNum,3)+"/"
                                                  +pad(parsedFilesNum,3)+" "+pad(itr,6)+" "+tmestamp;
                            fopen = false; fitr = fitr + 1;
                            if (parsedThisFileNum==parsedFilesNum) { // last file uploaded?
                               btnsDiv.style.display="block";
                               prgrsb.style.backgroundColor = '#ccc';
             									 prgrs.style.backgroundColor = '#ccc';
             									 plot.style.visibility = 'hidden';
             									 dataDiv.textContent = dataDiv.textContent.split("\r\n").slice(1).join("\r\n");
                               dataDiv.textcontent+="\r\n=================================================================";
															 connection.write(
		 														'\x10stpUp('+document.getElementById("HZ").value+','
		 															+document.getElementById("GS").value+','
		 															+((document.getElementById("ST").value=="")?25:document.getElementById("ST").value)+')\n');
                            } else {
                               timedUpload(connection, fitr);
                            }
                        }
       									break;
       				case 4:   // header just passed by:
                        dataDiv.textContent += " "+pad(GS,2)+" "+pad(HZ,4);
       									break;
       			}; // switch
          }); // on data
          fitr = 0;
          timedUpload(connection, 0);

       } else {
         console.log('failed to get back number of files from Bangle.\n');
				 connection.write(
					'\x10stpUp('+document.getElementById("HZ").value+','
						+document.getElementById("GS").value+','
						+((document.getElementById("ST").value=="")?25:document.getElementById("ST").value)+')\n');
         connect_done("Done. No data found.");
         return;
       }
    },2000); // wait 2 seconds for the number of binary files to come back

    // when the connection is closed (by the bangle), download the status as csv
    connection.on('close', function() {
      console.log('closing');
      if (status_len>0) { // avoid downloading an empty file
        console.log("Saving status CSV file");
        var csv = 'h,m,mag,dif,button1,button3,steps,mx,my,mz,battery,temp,heartrate,heartrate_c,err\n';
        rnd_itr = 0;
        while (rnd_itr<status_len) {
          if (h[rnd_itr]==255) { rnd_itr=status_len; }
          else {
            csv += h[rnd_itr]+','+m[rnd_itr]+','+mag[rnd_itr]+','+dif[rnd_itr];
            csv += ','+btn1[rnd_itr]+','+btn3[rnd_itr]+','+stps[rnd_itr]+',';
            csv += mx[rnd_itr]+','+my[rnd_itr]+','+mz[rnd_itr]+','+chrg[rnd_itr];
            csv += ','+tmp[rnd_itr]+','+hrm[rnd_itr]+','+hrc[rnd_itr]+',';
            csv += err[rnd_itr]+"\n";
            rnd_itr++;
          }
        }
        var hiddenElement = document.createElement('a');
        hiddenElement.href = 'data:text/csv;charset=utf-8,' + encodeURI(csv);
        hiddenElement.target = '_blank';
        hiddenElement.download = 'status.csv';
        hiddenElement.click();
      }
      //connect_done("Connection closed.");  // don't erase the listing!
    });
	});
}

//
function timedUpload(con, fi) {
  itr = 0;  // set iterator over file back to zero
  deltaCounter = 0; dmode = 0; rnd_itr = 0;  // reset parsing variables
  con.write('\x10sendNext('+fi+')\n', function(ret) {console.log('r:'+ret);} ); // send next file
  setTimeout( function (){
      if (fitr!=fi) {
        console.log('Check: all fine: '+fitr+'=/='+fi);
      } else {
        console.log('Check: hung data file upload: '+fitr+'=='+fi);
        //timedUpload(con, fitr);  // try again
      }
  }, 210000); // check for a hung BLE after 210 seconds and start next file download..
}


// handle packages
function handleReply(dta) {
    var Data = new Uint8Array(toByteArray(dta));
		var retcode = 0;
		if ((Data.length==17)&&(fopen==false)) {
			if (dta.substr(-".bin".length) === ".bin") {
				filename = dta; retcode = 1;
				deltaCounter = 0; dmode = 0; rnd_itr = 0; tmestamp = "";
        fopen = true;
        return retcode;
			}
		}
    if(fopen) {
        //console.log(Data);  // inspect data
        // parse as stop sequence:
        if (Data.length>14) {
          var sii=0;
          for (var ii=0;ii<Data.length-2;ii++) {
            if (((Data[ii]==255)&&((sii<5)||(sii>10)))||(((Data[ii]==0)&&((sii>4)&&(sii<11))))) {
              sii++;
            } else break; // Data isn't a stop sequence, so get out
            //if (sii>4) console.log('stop? '+sii+' '+ii+' '+Data.length)
          }
          if (sii>12) {
            parsedThisFileNum = Data[13];
            parsedFilesNum = Data[14];
            return 2; // eof found
          }
        }
        // otherwise parse as content:
				for (var i=0; i<Data.length; i++)
					readBuffer[itr+i] = Data[i];
				itr += Data.length;
				if (itr==20) { // should be header
					if (filename === "d20statusmsgs.bin") {
						GS = "--"; HZ = "----"; tmestamp = "--.--.----,--:--:--";
            rnd_itr = 0; dmode=0; status_len=0;
            parseStatus(Data);
					} else {
						var mts = new Date(Number( int64_to_str(Data,true) ));
						tmestamp = pad(mts.getDate(),2)+"."+pad(mts.getMonth()+1,2)+"."+pad(mts.getFullYear(),4)+",";
						tmestamp += pad(mts.getHours(),2)+":"+pad(mts.getMinutes(),2)+":"+pad(mts.getSeconds(),2);
					  if (Data[8]==16) GS=8; else if (Data[8]==8) GS=4; else if (Data[8]==0) GS=2;
						if (Data[9]==0) HZ=12.5; else if (Data[9]==1) HZ=25; else if (Data[9]==2) HZ=50; else if (Data[9]==3) HZ=100;
					}
					retcode = 4;
				} else { // if not header:
          if (filename === "d20statusmsgs.bin") {
            var r = parseStatus(Data);
            if (r==255) { console.log('returned'); retcode = 2; return retcode; }
            if (r==3) { retcode = 3; return retcode;  }
          }
          else {
            retcode = 3;
            //var startbyte=0;
						//if (itr==40) startbyte = 12;
            //var r = parseBin(Data,startbyte,Data.length);
            //retcode = 3;
            //if (r==255) {
            //  retcode = 2;
            //  return retcode;
            //}
            //if (r>0) {   // start after the header of 32 bytes
            //  retcode = 3;
            //  console.log('inconsistent data at '+itr+' '+Data);
            //}
          }
				} // else
		} else { console.log("Dangling data: "+dta+"(len="+dta.length+")"); }
		return retcode;
}


var downloadBlob, downloadURL;

downloadBlob = function(data, fileName, mimeType) {
  var blob, url;
  blob = new Blob([data], {
    type: mimeType
  });
  url = window.URL.createObjectURL(blob);
  downloadURL(url, fileName);
  setTimeout(function() {
    return window.URL.revokeObjectURL(url);
  }, 1000);
};

downloadURL = function(data, fileName) {
  var a;
  a = document.createElement('a');
  a.href = data;
  a.download = fileName;
  document.body.appendChild(a);
  a.style = 'display: none';
  a.click();
  a.remove();
};
