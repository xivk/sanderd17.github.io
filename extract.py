#!/usr/bin/env python
# vim: tabstop=4:softtabstop=4:shiftwidth=4:expandtab

# Import Psyco if available
try:
    import psyco
    psyco.full()
except ImportError:
    pass

from dbfpy.dbf import Dbf

import sys
import parser
import argparse
import os 
import io
import string
import re
import json
from lambert import Belgium1972LambertProjection
from multiprocessing import Process, Queue

parser = argparse.ArgumentParser(description='Reads the AGIV CRAB database in DBF and converts this to .csv format.')
parser.add_argument('path', help='The path to the CRAB DBF files.')
parser.add_argument('--filter-postcode', help='The postocde to filter on, will restrict data to this postcode only.', default='')
parser.add_argument('--output-dir', default='data/', help='The path to the output files.')
parser.add_argument('--threads', default='1', help='Max number of threads to use. (only part of the process will use the maximum number of threads)')
args = parser.parse_args()

straatnm_dbf = args.path + 'straatnm.dbf'
huisnr_dbf = args.path + 'huisnr.dbf'
pkancode_dbf = args.path + 'pkancode.dbf'
gem_dbf = args.path + 'gem.dbf'
tobjhnr_dbf = args.path + 'tobjhnr.dbf'
terrobj_dbf = args.path + 'terrobj.dbf'

do_pkancode = 1
do_terrobj = 1
do_tobjhnr = 1
do_huisnr = 1
do_straatnm = 1

totalThreads = int(args.threads)

# method to sanitize strings so they are valid on any platform (only alphanumeric chars allowed)
valid_chars = "%s%s" % (string.ascii_letters, string.digits)
def sanitize(string):
    return ''.join(c for c in string if c in valid_chars).lower()

# Split a range (from 0 to total) into numberChunks and return the ith chunk
# used for splitting a job over different threads
def getRangeChunk(total, i, numberChunks):
    start = total / numberChunks * i
    if numberChunks == i + 1:
        end = total # be sure to include it until the last one
    else:
        end = total / numberChunks * (i + 1)
    return range(start, end)

def dispProgress(i, total):
    if((i) % (total / 50) is 0 and not i is 0):
        sys.stdout.write('.')
        sys.stdout.flush()
    
postal_code = 0
if(len(args.filter_postcode) > 0):
    postal_code = int(args.filter_postcode)
    print 'filtering on postalcode: ' + str(postal_code)

'''
 final format of an addr object:
{
    housenumber: house number, as osm tag
    street: streetname, as osm tag
    lat: wsg84 latitude
    lon: wsg84 longitude
    pcode: 4-digit postal code
}
'''
# house number objects indexed by unique id
addr_dic = dict()
# house number objects, indexed per street id per postal code
pcode_dic = dict()
# dictionary linking streetname ids to actual names
straatnm_dic = dict()

# parse & index straatnm
# link street id to the streetname (in multiple languages) and the place code
def straatnm_Thread(ret, threadNum, totalThreads):
    straatnm_dic = dict()
    db = Dbf()
    db.openFile(straatnm_dbf, readOnly = 1)
    record_count = db.recordCount()

    for i in getRangeChunk(record_count, threadNum, totalThreads):
        rec = db[i]
    
        dispProgress(i, record_count)

        straatnm_dic[rec['ID']] = rec['STRAATNM']
    # send the dic to the main thread
    ret.put(straatnm_dic)

if(do_straatnm):
    print 'extracting streetname'
    queues = []
    procs = []
    for threadNum in range(0, totalThreads):
        q = Queue()
        queues.append(q)
        p = Process(target=straatnm_Thread, args=(q, threadNum, totalThreads,))
        procs.append(p)
        p.start()

    # get the data from all processes
    for q in queues:
        straatnm_dic.update(q.get())

    # wait here until all processes are finished
    for p in procs:
        p.join()
    print ''
    print str(len(straatnm_dic.keys())) + ' streets found.'

# parse & index pcode
# link post codes to house number ids

def pkancode_Thread(ret, threadNum, totalThreads):
    addr_dic = dict()
    pcode_dic = dict()
    db = Dbf()
    db.openFile(pkancode_dbf, readOnly = 1)
    record_count = int(db.recordCount())

    for i in getRangeChunk(record_count, threadNum, totalThreads):
        rec = db[i]

        dispProgress(i, record_count)

        # records with an einddatum are historic and should not be imported
        if rec['EINDDATUM'] != (0, 0, 0):
            continue

        addr_id = rec['HUISNRID']
        pcode = rec['PKANCODE']

        if(pcode == postal_code or postal_code is 0):
            addr_dic[addr_id] = {'pcode': pcode}
            pcode_dic[pcode] = dict()
    ret.put({'addr': addr_dic, 'pcode': pcode_dic})

if(do_pkancode):
    print 'extracting addresses per postal code'
    queues = []
    procs = []
    for threadNum in range(0, totalThreads):
        q = Queue()
        queues.append(q)
        p = Process(target=pkancode_Thread, args=(q, threadNum, totalThreads,))
        procs.append(p)
        p.start()

    # get the data from all processes
    for q in queues:
        data = q.get()
        addr_dic.update(data['addr'])
        pcode_dic.update(data['pcode'])

    # wait here until all processes are finished
    for p in procs:
        p.join()
    print ''
    print str(len(addr_dic.keys())) + ' addresses found.'

# parse & index tobjhnr
# Link terrain object ids to house number ids
def terrobj_Thread(ret, threadNum, totalThreads):
    terrobj_to_addr_id = dict()
    db = Dbf()
    db.openFile(tobjhnr_dbf, readOnly = 1)
    record_count = db.recordCount()

    for i in getRangeChunk(record_count, threadNum, totalThreads):
        rec = db[i]
    
        dispProgress(i, record_count)
    
        addr_id = rec['HUISNRID']
        if(addr_id in addr_dic):
            terrobj_to_addr_id[rec['TERROBJID']] = addr_id
    ret.put(terrobj_to_addr_id)

if(do_tobjhnr):
    print 'Extracting terrain objects'
    terrobj_to_addr_id = dict()
    queues = []
    procs = []
    for threadNum in range(0, totalThreads):
        q = Queue()
        queues.append(q)
        p = Process(target=terrobj_Thread, args=(q, threadNum, totalThreads,))
        procs.append(p)
        p.start()

    # get the data from all processes
    for q in queues:
        terrobj_to_addr_id.update(q.get())

    # wait here until all processes are finished
    for p in procs:
        p.join()
    print ''
    print str(len(terrobj_to_addr_id.keys())) + ' terrain objects found.'

# parse & index terrobj
# Link terrain object lambert coordinates to housenumber ids
projection = Belgium1972LambertProjection()
if(do_terrobj):
    print 'Calculating positions'
    db = Dbf()
    db.openFile(terrobj_dbf, readOnly = 1)
    record_count = db.recordCount()

    count = 0

    for i in range(0, record_count):
        rec = db[i]
    
        dispProgress(i, record_count)
    
        terrobj_id = rec['ID']
        if(terrobj_id in terrobj_to_addr_id):
            count += 1
            addr = addr_dic[terrobj_to_addr_id[terrobj_id]]
            # convert to lat/lon
            coordinates = projection.to_wgs84(rec['X'], rec['Y'])
            
            addr['lat'] = coordinates[0]
            addr['lon'] = coordinates[1]
            
    print ''
    print str(count) + " positions calculated."

# parse & index huisnr
# Link addresses to the actual housenumber and to the street
if(do_huisnr):
    print 'Extracting housenumber'
    db = Dbf()
    db.openFile(huisnr_dbf, readOnly = 1)
    record_count = db.recordCount()

    for i in range(0, record_count):
        rec = db[i]
    
        dispProgress(i, record_count)

        addr_id = rec['ID']
        if(addr_id in addr_dic):
            streetName = straatnm_dic[rec['STRAATNMID']]
            addr_dic[addr_id]['street'] = streetName
            addr_dic[addr_id]['housenumber'] = rec['HUISNR']

            # index the addresses per postal code and per (sanitized) streetname
            pcode = addr_dic[addr_id]['pcode']
            sanitizedStreetName = sanitize(streetName)
            if (sanitizedStreetName not in pcode_dic[pcode]):
                pcode_dic[pcode][sanitizedStreetName] = []

            pcode_dic[pcode][sanitizedStreetName].append(addr_dic[addr_id])

    print ''

###############################################################################
##                            WRITING DATA                                   ##
###############################################################################


print 'Writing files'

outputDir = args.output_dir
if (outputDir[-1] != '/'):
    outputDir += '/'

for pcode in pcode_dic:


    pcodeJson = {"streets": []}    

    names = sorted(pcode_dic[pcode].keys())

    for sanName in names:

        # sort addresses for uniqueness
        addresses = sorted(pcode_dic[pcode][sanName], key=lambda addr: addr['housenumber'])

        streetInfo = dict()
        streetInfo['b'] = 90.0
        streetInfo['t'] = -90.0
        streetInfo['l'] = 180.0
        streetInfo['r'] = -180.0
        streetInfo['numOfAddr'] = 0
        streetInfo['sanName'] = sanName

        for addr in addresses:

            if "lat" not in addr:
                continue

            streetInfo['numOfAddr'] += 1
            if addr['lat'] < streetInfo['b']:
                streetInfo['b'] = addr['lat']
            if addr['lon'] < streetInfo['l']:
                streetInfo['l'] = addr['lon']
            if addr['lat'] > streetInfo['t']:
                streetInfo['t'] = addr['lat']
            if addr['lon'] > streetInfo['r']:
                streetInfo['r'] = addr['lon']

        if streetInfo['numOfAddr'] == 0:
            continue

        streetInfo['name'] = addresses[0]['street']
        # make directory per postal code
        directory = outputDir + str(pcode) + "/"
        if not os.path.exists(directory):
            os.makedirs(directory)

        # write the addresses per street to a file
        # and yes, the encoding of the CRAB names is cp720,
        # about the most obscure encoding I ever encountered
        # http://www.lingua-systems.com/unicode-converter/unicode-mappings/encode-cp720-to-utf8-unicode.html
        with io.open(directory + sanName + ".json", 'wb') as json_file:
            json.dump({'addresses': addresses}, json_file, indent = 2, encoding='cp720', sort_keys=True)

        # save the street info
        pcodeJson["streets"].append(streetInfo)

    # write the 
    if len(pcodeJson["streets"]) == 0:
        continue

    with io.open(outputDir + str(pcode) + ".json", 'wb') as json_file:
        json.dump(pcodeJson, json_file, indent = 2, encoding='cp720', sort_keys=True)


