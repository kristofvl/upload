/*
--------------------------------------------------------------------
inspect.js Wearable Data Inspect Tool
 Copyright 2021 by Kristof Van Laerhoven (ubicomp.eti.uni-siegen.de)
--------------------------------------------------------------------
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
--------------------------------------------------------------------

Version date: 2021-04-15

TODO:
- more interactive plotting!
*/

var plot;
var len = 70000;
var lbls;
var dx = new Int16Array(len);
var dy = new Int16Array(len);
var dz = new Int16Array(len);
var itr = 0;

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

// zero-pad our numbers
function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

function graphClickEvent(event, array){
    console.log('click event', array);
}

// on loading the window, init the plot canvas and assign vars to all elements we want to control:
window.onload = function() {
  lbls = Array.from({length: len}, (_, i) => i + 1);
  var config_acc = {
  	type: 'line',
  	data: {
  		labels: lbls,
  		datasets: [{ label: 'x, ', data:dx,
  			borderColor: 'rgba(255, 0, 0, 200)', pointRadius:.1, borderWidth:1,
  			backgroundColor: 'rgba(0, 0, 0, 0)',fill:false,lineTension:0
  		}, {  label: 'y, ', data:dy,
  			borderColor: 'rgba(0, 255, 0, 200)', pointRadius:.1, borderWidth:1,
  			backgroundColor: 'rgba(0, 0, 0, 0)',fill:false,lineTension:0
  		}, {  label: 'z', data:dz,
  			borderColor: 'rgba(0, 0, 255, 200)', pointRadius:.1, borderWidth:1,
  			backgroundColor: 'rgba(0, 0, 0, 0)',fill:false,lineTension:0
  		}]
  	},
  	options: { tooltips:{enabled: false}, events:['click'],
  		legend: {position:'top', align:'end', rtl:false, labels:{boxWidth:3,padding:1}},
  		normalized: true, animation: false, responsive: true,
  		title: { display: false, text: '' },
  		scales: { xAxes:[{display:true, scaleLabel:{display:true}}],
  							yAxes:[{display:true, scaleLabel:{display:false},
  											ticks: { min:-33000, max:33000, stepSize:8000}}]
  		}, onClick: graphClickEvent
  	}
  };

	var ctx_acc = document.getElementById('plotcanvas').getContext('2d');
  window.myLine = new Chart(ctx_acc, config_acc);
  plot = document.getElementById('plot');
  plot.style.visibility = 'hidden';
  document.getElementById("upzone").style.width="99%";
  document.getElementById("upzone").style.height="30px";
};


var ddup = {
  hzone: null, // bin file upload zone
  hstat: null, // bin file upload status
  init : function () {
    ddup.hzone = document.getElementById("upzone");
    ddup.hstat = document.getElementById("info");
    ddup.box = document.getElementById("box");

    // if we can drag and drop:
    if (window.File && window.FileReader && window.FileList && window.Blob) {
      ddup.hzone.addEventListener("dragenter", function (e) {  // highlight:
        e.preventDefault();
        e.stopPropagation();
        ddup.hzone.classList.add('highlight');
      });
      ddup.hzone.addEventListener("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        ddup.hzone.classList.remove('highlight');
      });
      ddup.hzone.addEventListener("dragover", function (e) { // drop:
        e.preventDefault();
        e.stopPropagation();
      });
      ddup.hzone.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        ddup.hzone.classList.remove('highlight');
        ddup.plot(e.dataTransfer.files);
      });
    }
    else {  // drag and drop is not supported here:
      ddup.hzone.style.display = "none";
      ddup.hform.style.display = "block";
    }
  },
  plot : function (files) {
    ddup.box.style.width="inherit";
    ddup.hzone.style.width="99%";
    for (var ii=0;ii<files.length;ii++) {  // for all dragged files ..
      ddup.hstat.textContent = files[ii].name+", size: "+files[ii].size;
      ddup.hstat.textContent += ", from: "+files[ii].lastModifiedDate+"\n";
      var reader = new FileReader();
      reader.onload = () => {
       const value = new Uint8Array(reader.result);
       var ii;
       var hd = value.slice(0,32);
          // interpret header start time:
          var mts = new Date(Number( int64_to_str(hd,true) ));
          millis = int64_to_str(hd,true);
          var tmestamp = pad(mts.getDate(),2)+"."+pad(mts.getMonth()+1,2)+"."+pad(mts.getFullYear(),4)+",";
          tmestamp += pad(mts.getHours(),2)+":"+pad(mts.getMinutes(),2)+":"+pad(mts.getSeconds(),2);
          var GS,HZ;
          if (hd[8]==16) GS=8; else if (hd[8]==8) GS=4; else if (hd[8]==0) GS=2;
          if (hd[9]==0) HZ=12.5; else if (hd[9]==1) HZ=25; else if (hd[9]==2) HZ=50; else if (hd[9]==3) HZ=100;
          var title = files[0].name+", started at "+tmestamp+" with GS="+GS+", HZ="+HZ;
       var delta = false, deltaval=-1, packt = 0;
       var sample = new Uint8Array(6);
       var infoStr = "header: "+hd+"\n";
       var csvStr = "time,acc_x,acc_y,acc_z\n";  // do not preceed with #!
       lbls = [];
       itr=0;
       for (ii=32;ii<value.length-3;ii+=3) { // iterate over data
         if ((ii-32)%7200==0)
          infoStr += "\n==== new page ====\n";  // mark start of new page
         if (delta==false) {
           if ((value[ii]==255)&&(value[ii+1]==255)&&(packt==0)) { // delta starts
             if (value[ii+2]==255) {
               infoStr += "\n*"+(ii+2)+"\n";  // error -> this should only happen at the end of a page
             } else {
               infoStr += "\nd"+value[ii+2]+":";
               delta = true;
               deltaval = value[ii+2];
             }
           } else {
             if (packt==0) {
               infoStr += "["+value[ii].toString(16)+value[ii+1].toString(16)+","+value[ii+2].toString(16);
               sample[0]=value[ii]; sample[1]=value[ii+1]; sample[2]=value[ii+2];
               packt=1;
             } else {
               infoStr += value[ii].toString(16)+","+value[ii+1].toString(16)+value[ii+2].toString(16)+"]";
               sample[3]=value[ii]; sample[4]=value[ii+1]; sample[5]=value[ii+2];
               packt=0;
               // add to plot
               mts = new Date(mts.getTime()+(1000/HZ));
               lbls[itr] = pad(mts.getHours(),2)+":"+pad(mts.getMinutes(),2)+":"+pad(mts.getSeconds(),2);
               dx[itr] = sample[0]|(sample[1]<<8);
               dy[itr] = sample[2]|(sample[3]<<8);
               dz[itr] = sample[4]|(sample[5]<<8);
               //csvStr += pad(mts.getDate(),2)+"."+pad(mts.getMonth()+1,2)+"."+pad(mts.getFullYear(),4)+",";
               csvStr += lbls[itr]+"."+pad(mts.getMilliseconds(),3)+","+(dx[itr]/4096).toFixed(5)+","+(dy[itr]/4096).toFixed(5)+","+(dz[itr]/4096).toFixed(5)+";\n";
               itr++;
            }
           }
         } else {
           infoStr += "["+value[ii].toString(16)+","+value[ii+1].toString(16)+","+value[ii+2].toString(16)+"]";
           sample[0]=value[ii]; sample[2]=value[ii+1]; sample[4]=value[ii+2]; // fill LSBs after delta
           mts = new Date(mts.getTime()+(1000/HZ));
           lbls[itr] = pad(mts.getHours(),2)+":"+pad(mts.getMinutes(),2)+":"+pad(mts.getSeconds(),2);
           dx[itr] = sample[0]|(sample[1]<<8);
           dy[itr] = sample[2]|(sample[3]<<8);
           dz[itr] = sample[4]|(sample[5]<<8);
           csvStr += lbls[itr]+"."+pad(mts.getMilliseconds(),3)+","+(dx[itr]/4096).toFixed(5)+","+(dy[itr]/4096).toFixed(5)+","+(dz[itr]/4096).toFixed(5)+";\n";
           itr++;
           deltaval--;
           if (deltaval<0) {
             delta = false;
             infoStr += "\n";
           }
         }
       } // for
       ddup.hzone.textContent =  infoStr;//infoStr;
       plot.style.visibility = 'visible';
       myLine.config.options.title.text = title;
       myLine.config.options.title.display = true;
       myLine.config.options.scales.xAxes[0].ticks.max = itr-1;
       myLine.config.options.scales.yAxes[0].ticks.min = -18000;
       myLine.config.options.scales.yAxes[0].ticks.max = 18000;
       myLine.config.data.labels = lbls;
       window.myLine.update();

       // after plotting each file, export CSV:
       var hiddenElement = document.createElement('a');
       hiddenElement.href = 'data:text/csv;charset=utf-8,' + encodeURI(csvStr); //csvStr or infoStr
       hiddenElement.target = '_blank';
       hiddenElement.download = 'exported_data.csv';
       hiddenElement.click();
       // done saving csv

      };  // reader.onload
      reader.readAsArrayBuffer(files[ii]); // this invokes onload above

    }

  }
};
window.addEventListener("DOMContentLoaded", ddup.init);
