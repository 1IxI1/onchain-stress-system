import { Address, Transaction } from 'ton-core';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { Blockchain } from '@ton-community/sandbox';

export const auto = path.join(__dirname, '..', 'contracts', 'auto');

export async function setMasterCounter(masterCounter: Address) {
    await mkdir(auto, { recursive: true });
    await writeFile(
        path.join(auto, `master-counter-address.fc`),
        `const slice master_counter_address = "${masterCounter.toString()}"a;`
    );
}

const decimalCount = 9;
const decimal = pow10(decimalCount);

function pow10(n: number): bigint {
    let v = 1n;
    for (let i = 0; i < n; i++) {
        v *= 10n;
    }
    return v;
}

function formatCoinsPure(value: bigint, precision = 6): string {
    let whole = value / decimal;

    let frac = value % decimal;
    const precisionDecimal = pow10(decimalCount - precision);
    if (frac % precisionDecimal > 0n) {
        // round up
        frac += precisionDecimal;
        if (frac >= decimal) {
            frac -= decimal;
            whole += 1n;
        }
    }
    frac /= precisionDecimal;

    return `${whole.toString()}${frac !== 0n ? '.' + frac.toString().padStart(precision, '0').replace(/0+$/, '') : ''}`;
}

function formatCoins(value: bigint | undefined, precision = 6): string {
    if (value === undefined) return 'N/A';

    return formatCoinsPure(value, precision) + ' TON';
}

export async function printSpamChain(transactions: Transaction[], masterCounter?: Address) {
    console.table(
        transactions
            .map((tx) => {
                if (tx.description.type !== 'generic') return undefined;

                const inBody = ['internal', 'external-in'].includes(tx.inMessage?.info.type || '')
                    ? tx.inMessage?.body.beginParse()
                    : undefined;
                let fromId =
                    inBody === undefined ? 'N/A' : inBody.remainingBits >= 16 ? inBody.preloadUint(16) : 'no id';

                let inTxType = 'hop';
                if (inBody?.remainingBits == 16) {
                    // only 16 bits in report msg
                    inTxType = 'report';
                }
                const dest = tx.inMessage?.info.dest;
                if (dest && Address.isAddress(dest) && masterCounter?.equals(dest)) {
                    inTxType = 'master';
                }

                if (tx.inMessage?.info.type == 'external-in') fromId = '-';

                let toId: string | number = 'no out';
                let outTxType = 'no out';

                if (tx.outMessages.size >= 1) {
                    const outMsg = tx.outMessages.get(0);
                    toId = outMsg?.body.beginParse().preloadUint(16) || 'no id';
                    const dest = outMsg?.info.dest;
                    if (dest && Address.isAddress(dest) && masterCounter?.equals(dest)) {
                        toId = outTxType = 'master';
                    }
                }

                if (toId == 0xffff) toId = 'bounce';
                if (fromId == 0xffff) {
                    fromId = 'bounced';
                    inTxType = 'bounce';
                }

                const valueIn = formatCoins(
                    tx.inMessage?.info.type === 'internal' ? tx.inMessage.info.value.coins : undefined
                );

                const valueOut = formatCoins(
                    tx.outMessages
                        .values()
                        .reduce(
                            (total, message) =>
                                total + (message.info.type === 'internal' ? message.info.value.coins : 0n),
                            0n
                        )
                );

                const computeFees = formatCoins(
                    tx.description.computePhase.type === 'vm' ? tx.description.computePhase.gasFees : undefined
                );

                const exitCode =
                    tx.description.computePhase.type === 'vm' ? tx.description.computePhase.exitCode : 'N/A';

                let status = 'ok';
                if (exitCode !== 0) status = 'failed ' + exitCode.toString();

                return {
                    onContract: inTxType,
                    status,
                    fromId,
                    toId,
                    outTxType,
                    valueIn,
                    valueOut,
                    outActions: tx.description.actionPhase?.totalActions ?? 'N/A',
                    computeFees,
                    exitCode,
                    actionCode: tx.description.actionPhase?.resultCode ?? 'N/A',
                };
            })
            .filter((v) => v !== undefined)
    );
}